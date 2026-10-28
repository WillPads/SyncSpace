import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError, fieldError, isUuid, parseInput, parseLimit, routeParam } from "../lib/http.js";
import { type RateLimiters, limitBy } from "../lib/rateLimit.js";
import {
  MAX_DURATION_MIN,
  MAX_LEAD_MS,
  MAX_UPCOMING_PER_ROOM,
  MIN_DURATION_MIN,
  pruneEndedSessions,
  upcomingSessions,
} from "../lib/schedule.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoomRole } from "../middleware/requireRoomRole.js";

const DEFAULT_UPCOMING_LIMIT = 10;
const MAX_UPCOMING_LIMIT = 20;

const startsAt = z
  .string(fieldError("startsAt", "an ISO 8601 date-time"))
  .datetime({ offset: true, error: "startsAt must be an ISO 8601 date-time, like 2026-11-03T18:00:00Z." })
  .transform((value) => new Date(value))
  .superRefine((date, ctx) => {
    const now = Date.now();
    if (date.getTime() <= now) ctx.addIssue({ code: "custom", message: "Pick a start time in the future." });
    else if (date.getTime() > now + MAX_LEAD_MS) {
      ctx.addIssue({ code: "custom", message: "Sessions can be planned at most a year ahead." });
    }
  });

const durationMin = z
  .number(fieldError("durationMin", "a number of minutes"))
  .int("durationMin must be a whole number of minutes.")
  .min(MIN_DURATION_MIN, `Sessions must be at least ${MIN_DURATION_MIN} minutes.`)
  .max(MAX_DURATION_MIN, `Sessions can be at most ${MAX_DURATION_MIN} minutes.`);

const createSchema = z.object({ startsAt, durationMin });
const updateSchema = z.object({ startsAt: startsAt.optional(), durationMin: durationMin.optional() });

const notFound = () => new HttpError(404, "SCHEDULE_NOT_FOUND", "Scheduled session not found.");

function serializeSession(session: {
  id: string;
  roomId: string;
  startsAt: Date;
  durationMin: number;
  createdById: string | null;
}) {
  return {
    id: session.id,
    roomId: session.roomId,
    startsAt: session.startsAt.toISOString(),
    durationMin: session.durationMin,
    createdById: session.createdById,
  };
}

/** The room calendar (admins write, members read) plus the dashboard's "coming up" list. */
export function createScheduleRouter(limits: RateLimiters): Router {
  const router = Router();
  const writeLimit = limitBy(
    limits.scheduleWritePerUser,
    (req) => req.user?.id ?? null,
    "You're changing the schedule too quickly. Try again later."
  );

  router.get("/rooms/:roomId/schedule", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
    const roomId = routeParam(req, "roomId");
    const now = new Date();
    await pruneEndedSessions([roomId], now);
    const sessions = await upcomingSessions([roomId], now);
    res.json({ sessions: sessions.map(serializeSession) });
  });

  router.post("/rooms/:roomId/schedule", requireAuth, requireRoomRole("ADMIN"), writeLimit, async (req, res) => {
    const input = parseInput(createSchema, req.body);
    const roomId = routeParam(req, "roomId");
    const now = new Date();
    await pruneEndedSessions([roomId], now);

    const session = await prisma.$transaction(async (tx) => {
      // Lock the room so two simultaneous requests can't both see 19 sessions and make it 21.
      await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
      const upcoming = await upcomingSessions([roomId], now);
      if (upcoming.length >= MAX_UPCOMING_PER_ROOM) {
        throw new HttpError(409, "CONFLICT", `This room already has ${MAX_UPCOMING_PER_ROOM} upcoming sessions. Delete one first.`);
      }
      return tx.scheduledSession.create({
        data: { roomId, createdById: req.user!.id, startsAt: input.startsAt, durationMin: input.durationMin },
      });
    });
    res.status(201).json({ session: serializeSession(session) });
  });

  router.patch("/rooms/:roomId/schedule/:id", requireAuth, requireRoomRole("ADMIN"), writeLimit, async (req, res) => {
    const input = parseInput(updateSchema, req.body);
    if (input.startsAt === undefined && input.durationMin === undefined) {
      throw new HttpError(400, "VALIDATION_ERROR", "Provide startsAt and/or durationMin to change.");
    }
    const id = routeParam(req, "id");
    if (!isUuid(id)) throw notFound();
    // updateMany with the room in the filter: a session id from another room is simply "not found".
    const { count } = await prisma.scheduledSession.updateMany({
      where: { id, roomId: routeParam(req, "roomId") },
      data: { startsAt: input.startsAt, durationMin: input.durationMin },
    });
    if (count === 0) throw notFound();
    const session = await prisma.scheduledSession.findUnique({ where: { id } });
    if (!session) throw notFound();
    res.json({ session: serializeSession(session) });
  });

  router.delete("/rooms/:roomId/schedule/:id", requireAuth, requireRoomRole("ADMIN"), writeLimit, async (req, res) => {
    const id = routeParam(req, "id");
    if (!isUuid(id)) throw notFound();
    const { count } = await prisma.scheduledSession.deleteMany({ where: { id, roomId: routeParam(req, "roomId") } });
    if (count === 0) throw notFound();
    res.status(204).end();
  });

  router.get("/schedule/upcoming", requireAuth, async (req, res) => {
    const limit = parseLimit(req.query.limit, DEFAULT_UPCOMING_LIMIT, MAX_UPCOMING_LIMIT);
    const memberships = await prisma.participant.findMany({ where: { userId: req.user!.id }, select: { roomId: true } });
    const roomIds = memberships.map((m) => m.roomId);
    const now = new Date();
    await pruneEndedSessions(roomIds, now);
    const sessions = await upcomingSessions(roomIds, now, limit);
    res.json({ sessions: sessions.map((s) => ({ ...serializeSession(s), roomName: s.room.name })) });
  });

  return router;
}
