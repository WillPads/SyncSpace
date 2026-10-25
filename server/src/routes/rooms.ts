import { Prisma } from "@prisma/client";
import { type Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS, applyAction } from "../lib/fsm.js";
import { HttpError, fieldError, isUuid, parseInput, routeParam } from "../lib/http.js";
import { type RateLimiters, limitBy } from "../lib/rateLimit.js";
import { generateRoomCode, isRoomCode } from "../lib/roomCode.js";
import { type RoomWithRelations, loadRoom, roomInclude, serializeRoom } from "../lib/roomView.js";
import { removeUploads } from "../lib/documentPipeline.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoomRole } from "../middleware/requireRoomRole.js";
import { closeRoom, disconnectUser, sendToRoom } from "../ws/registry.js";
import { forgetRoom, publishRoom } from "../ws/roomFeed.js";

/** Hard ceiling on room size, whatever a room row says. */
export const MAX_ROOM_CAPACITY = 10;
const DEFAULT_FOCUS_SEC = 1500;
const DEFAULT_BREAK_SEC = 300;
// How many times to retry a timer action that lost a race with another one.
const SESSION_WRITE_ATTEMPTS = 3;

const durationSchema = z
  .number({ error: "Durations must be numbers of seconds." })
  .int("Durations must be whole seconds.")
  .min(MIN_DURATION_SECONDS, `Durations must be at least ${MIN_DURATION_SECONDS} seconds.`)
  .max(MAX_DURATION_SECONDS, `Durations can be at most ${MAX_DURATION_SECONDS} seconds.`);

const createRoomSchema = z.object({
  name: z
    .string(fieldError("Room name", "text"))
    .trim()
    .min(1, "Room name is required.")
    .max(60, "Room name must be at most 60 characters."),
  focusDurationSec: durationSchema.optional(),
  breakDurationSec: durationSchema.optional(),
  inviteEnabled: z.boolean().optional(),
});

const inviteToggleSchema = z.object({ enabled: z.boolean({ error: "enabled must be true or false." }) });

const sessionActionSchema = z.object({
  action: z.enum(["start", "pause", "resume", "skip", "endSession", "reset"], {
    error: "Unknown session action.",
  }),
  focusDurationSec: durationSchema.optional(),
  breakDurationSec: durationSchema.optional(),
});

const taskSchema = z.object({
  task: z.string(fieldError("task", "text")).trim().max(120, "Tasks can be at most 120 characters."),
});

const mediaSchema = z
  .object({ cameraOn: z.boolean().optional(), micOn: z.boolean().optional() })
  .refine((data) => data.cameraOn !== undefined || data.micOn !== undefined, {
    message: "Provide cameraOn and/or micOn.",
  });

function roomNotFound(): HttpError {
  return new HttpError(404, "ROOM_NOT_FOUND", "Room not found.");
}

function sendRoom(res: Response, room: RoomWithRelations | null, status = 200): void {
  if (!room) throw roomNotFound();
  res.status(status).json({ room: serializeRoom(room) });
}

function isCodeCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  return !Array.isArray(target) || target.includes("code");
}

export function createRoomsRouter(limits: RateLimiters): Router {
  const router = Router();

  router.get("/", requireAuth, async (req, res) => {
    const rooms = await prisma.room.findMany({
      where: { participants: { some: { userId: req.user!.id } } },
      include: roomInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const now = new Date();
    res.json({ rooms: rooms.map((room) => serializeRoom(room, now)) });
  });

  router.post(
    "/",
    requireAuth,
    limitBy(limits.createRoomPerUser, (req) => req.user?.id ?? null, "You're creating rooms too quickly. Try again later."),
    async (req, res) => {
      const { name, focusDurationSec, breakDurationSec, inviteEnabled } = parseInput(createRoomSchema, req.body);
      const focus = focusDurationSec ?? DEFAULT_FOCUS_SEC;
      const brk = breakDurationSec ?? DEFAULT_BREAK_SEC;

      // The unique index on Room.code is the real guarantee; a collision just means "roll again".
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const room = await prisma.room.create({
            data: {
              code: generateRoomCode(),
              name,
              adminId: req.user!.id,
              inviteEnabled: inviteEnabled ?? false,
              capacity: MAX_ROOM_CAPACITY,
              participants: { create: { userId: req.user!.id, role: "ADMIN" } },
              session: { create: { focusDurationSec: focus, breakDurationSec: brk, remainingSeconds: focus } },
            },
            include: roomInclude,
          });
          sendRoom(res, room, 201);
          return;
        } catch (err) {
          if (!isCodeCollision(err)) throw err;
        }
      }
      throw new HttpError(503, "CODE_EXHAUSTED", "Couldn't allocate a room code. Try again.");
    }
  );

  router.post(
    "/:code/join",
    requireAuth,
    limitBy(limits.joinPerUser, (req) => req.user?.id ?? null, "Too many join attempts. Wait a few minutes and try again."),
    async (req, res) => {
      const code = routeParam(req, "code").trim().toUpperCase();
      if (!isRoomCode(code)) {
        throw new HttpError(404, "ROOM_NOT_FOUND", "Room not found. Double-check the code and try again.");
      }
      const userId = req.user!.id;

      const outcome = await prisma.$transaction(async (tx) => {
        // Lock the room row. Concurrent joins queue up here, so two requests can't both pass
        // the capacity check below and push the room past its limit.
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Room" WHERE "code" = ${code} FOR UPDATE`;
        const roomId = locked[0]?.id;
        if (!roomId) throw new HttpError(404, "ROOM_NOT_FOUND", "Room not found. Double-check the code and try again.");

        const room = await tx.room.findUniqueOrThrow({
          where: { id: roomId },
          select: { adminId: true, inviteEnabled: true, capacity: true },
        });
        const existing = await tx.participant.findUnique({
          where: { roomId_userId: { roomId, userId } },
          select: { id: true },
        });
        if (existing) {
          await tx.participant.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
          return { roomId, joined: false };
        }

        const isAdmin = room.adminId === userId;
        if (!isAdmin) {
          const ban = await tx.roomBan.findUnique({ where: { roomId_userId: { roomId, userId } } });
          if (ban) throw new HttpError(403, "REMOVED_FROM_ROOM", "The host removed you from this room.");
          if (!room.inviteEnabled) {
            throw new HttpError(403, "INVITES_DISABLED", "Invites are currently disabled by the room admin.");
          }
        }
        const count = await tx.participant.count({ where: { roomId } });
        if (count >= Math.min(room.capacity, MAX_ROOM_CAPACITY)) {
          throw new HttpError(409, "ROOM_FULL", "This room is full.");
        }
        await tx.participant.create({ data: { roomId, userId, role: isAdmin ? "ADMIN" : "MEMBER" } });
        return { roomId, joined: true };
      });

      if (outcome.joined) {
        sendRoom(res, await publishRoom(outcome.roomId), 201);
      } else {
        sendRoom(res, await loadRoom(outcome.roomId));
      }
    }
  );

  router.get("/:roomId", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
    sendRoom(res, await loadRoom(routeParam(req, "roomId")));
  });

  router.delete("/:roomId", requireAuth, requireRoomRole("ADMIN"), async (req, res) => {
    const roomId = routeParam(req, "roomId");
    const pending = await prisma.document.findMany({
      where: { roomId, status: { in: ["PENDING", "PARSING"] } },
      select: { storagePath: true },
    });
    // Everything in the room (members, timer, documents, quizzes, bans) cascades.
    await prisma.room.delete({ where: { id: roomId } });
    await removeUploads(pending.map((doc) => doc.storagePath));
    sendToRoom(roomId, { type: "room:deleted", roomId });
    closeRoom(roomId);
    forgetRoom(roomId);
    res.status(204).end();
  });

  router.patch("/:roomId/invite", requireAuth, requireRoomRole("ADMIN"), async (req, res) => {
    const { enabled } = parseInput(inviteToggleSchema, req.body);
    const roomId = routeParam(req, "roomId");
    await prisma.room.update({ where: { id: roomId }, data: { inviteEnabled: enabled } });
    sendRoom(res, await publishRoom(roomId));
  });

  // Admins remove anyone; members may only remove themselves (leave the room). Someone the
  // admin removes is banned, so they can't walk straight back in with the code.
  router.delete(
    "/:roomId/participants/:userId",
    requireAuth,
    requireRoomRole("ADMIN", "MEMBER"),
    async (req, res) => {
      const roomId = routeParam(req, "roomId");
      const targetId = routeParam(req, "userId");
      const isSelf = targetId === req.user!.id;
      if (req.participant!.role !== "ADMIN" && !isSelf) {
        throw new HttpError(403, "FORBIDDEN", "You do not have permission to do that.");
      }
      if (!isUuid(targetId)) {
        throw new HttpError(404, "NOT_A_PARTICIPANT", "That user is not a participant of this room.");
      }

      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { adminId: true } });
      if (!room) throw roomNotFound();
      if (room.adminId === targetId) {
        throw new HttpError(400, "ADMIN_CANNOT_LEAVE", "The room admin can't be removed.");
      }

      await prisma.$transaction(async (tx) => {
        const { count } = await tx.participant.deleteMany({ where: { roomId, userId: targetId } });
        if (count === 0) throw new HttpError(404, "NOT_A_PARTICIPANT", "That user is not a participant of this room.");
        if (!isSelf) {
          await tx.roomBan.upsert({
            where: { roomId_userId: { roomId, userId: targetId } },
            create: { roomId, userId: targetId },
            update: {},
          });
        }
      });

      disconnectUser(roomId, targetId);
      sendRoom(res, await publishRoom(roomId));
    }
  );

  router.get("/:roomId/bans", requireAuth, requireRoomRole("ADMIN"), async (req, res) => {
    const bans = await prisma.roomBan.findMany({
      where: { roomId: routeParam(req, "roomId") },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { displayName: true } } },
    });
    res.json({
      bans: bans.map((ban) => ({
        userId: ban.userId,
        displayName: ban.user.displayName,
        createdAt: ban.createdAt.toISOString(),
      })),
    });
  });

  router.delete("/:roomId/bans/:userId", requireAuth, requireRoomRole("ADMIN"), async (req, res) => {
    const roomId = routeParam(req, "roomId");
    const targetId = routeParam(req, "userId");
    const { count } = await prisma.roomBan.deleteMany({ where: { roomId, userId: targetId } });
    if (count === 0) throw new HttpError(404, "NOT_BANNED", "That user isn't banned from this room.");
    res.status(204).end();
  });

  router.post("/:roomId/session", requireAuth, requireRoomRole("ADMIN"), async (req, res) => {
    const { action, focusDurationSec, breakDurationSec } = parseInput(sessionActionSchema, req.body);
    const roomId = routeParam(req, "roomId");

    // Optimistic concurrency: the write only lands if nobody else changed the timer since we
    // read it (same version). On a clash, re-read and re-apply against the new state.
    for (let attempt = 1; ; attempt++) {
      const session = await prisma.pomodoroSession.findUnique({ where: { roomId } });
      if (!session) throw roomNotFound();

      const result = applyAction(session, action, new Date(), { focusDurationSec, breakDurationSec });
      if (!result.ok) throw new HttpError(409, "INVALID_TRANSITION", result.error);

      const { count } = await prisma.pomodoroSession.updateMany({
        where: { roomId, version: session.version },
        data: { ...result.patch, version: { increment: 1 } },
      });
      if (count === 1) break;
      if (attempt >= SESSION_WRITE_ATTEMPTS) {
        throw new HttpError(409, "CONFLICT", "The timer changed at the same moment. Try again.");
      }
    }

    sendRoom(res, await publishRoom(roomId));
  });

  router.patch("/:roomId/task", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
    const { task } = parseInput(taskSchema, req.body);
    const roomId = routeParam(req, "roomId");
    await prisma.participant.update({ where: { roomId_userId: { roomId, userId: req.user!.id } }, data: { task } });
    sendRoom(res, await publishRoom(roomId));
  });

  router.patch("/:roomId/media", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
    const media = parseInput(mediaSchema, req.body);
    const roomId = routeParam(req, "roomId");
    await prisma.participant.update({ where: { roomId_userId: { roomId, userId: req.user!.id } }, data: media });
    sendRoom(res, await publishRoom(roomId));
  });

  return router;
}
