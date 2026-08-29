import type { PomodoroSession } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { MIN_DURATION_SECONDS, applyAction, type SessionAction } from "../lib/fsm.js";
import { roomInclude, resolveAndLoadRoom, serializeRoom } from "../lib/roomView.js";
import { uniqueRoomCode } from "../lib/roomCode.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoomRole } from "../middleware/requireRoomRole.js";
import { broadcastRoomUpdate } from "../ws/index.js";

export const roomsRouter = Router();

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(60),
  focusDurationSec: z.number().int().min(MIN_DURATION_SECONDS).optional(),
  breakDurationSec: z.number().int().min(MIN_DURATION_SECONDS).optional(),
});

roomsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
    return;
  }
  const { name, focusDurationSec, breakDurationSec } = parsed.data;
  const focus = focusDurationSec ?? 1500;
  const brk = breakDurationSec ?? 300;

  const code = await uniqueRoomCode(async (candidate) => {
    const existing = await prisma.room.findUnique({ where: { code: candidate } });
    return existing !== null;
  });

  const room = await prisma.room.create({
    data: {
      code,
      name,
      adminId: req.user!.id,
      participants: { create: { userId: req.user!.id, role: "ADMIN" } },
      session: { create: { focusDurationSec: focus, breakDurationSec: brk, remainingSeconds: focus } },
    },
    include: roomInclude,
  });

  res.status(201).json({ room: serializeRoom(room) });
});

roomsRouter.post("/:code/join", requireAuth, async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const room = await prisma.room.findUnique({ where: { code }, include: roomInclude });
  if (!room) {
    res.status(404).json({ error: "Room not found. Double-check the code and try again." });
    return;
  }

  const existing = room.participants.find((p) => p.userId === req.user!.id);
  if (existing) {
    await prisma.participant.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
    const fresh = await resolveAndLoadRoom(room.id);
    res.json({ room: serializeRoom(fresh!) });
    return;
  }

  const isAdmin = room.adminId === req.user!.id;
  if (!room.inviteEnabled && !isAdmin) {
    res.status(403).json({ error: "Invites are currently disabled by the room admin." });
    return;
  }
  if (room.participants.length >= room.capacity) {
    res.status(409).json({ error: "This room is full." });
    return;
  }

  await prisma.participant.create({ data: { roomId: room.id, userId: req.user!.id, role: "MEMBER" } });
  const fresh = await resolveAndLoadRoom(room.id);
  void broadcastRoomUpdate(room.id);
  res.status(201).json({ room: serializeRoom(fresh!) });
});

roomsRouter.get("/:roomId", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
  const room = await resolveAndLoadRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  res.json({ room: serializeRoom(room) });
});

const inviteToggleSchema = z.object({ enabled: z.boolean() });

roomsRouter.patch("/:roomId/invite", requireAuth, requireRoomRole("ADMIN"), async (req, res) => {
  const parsed = inviteToggleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input." });
    return;
  }
  await prisma.room.update({ where: { id: req.params.roomId }, data: { inviteEnabled: parsed.data.enabled } });
  const room = await resolveAndLoadRoom(req.params.roomId);
  void broadcastRoomUpdate(req.params.roomId);
  res.json({ room: serializeRoom(room!) });
});

roomsRouter.delete(
  "/:roomId/participants/:userId",
  requireAuth,
  requireRoomRole("ADMIN"),
  async (req, res) => {
    const { roomId, userId } = req.params;
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (room?.adminId === userId) {
      res.status(400).json({ error: "The room admin can't be removed." });
      return;
    }

    const participant = await prisma.participant.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!participant) {
      res.status(404).json({ error: "That user is not a participant of this room." });
      return;
    }

    await prisma.participant.delete({ where: { id: participant.id } });
    const fresh = await resolveAndLoadRoom(roomId);
    void broadcastRoomUpdate(roomId);
    res.json({ room: serializeRoom(fresh!) });
  }
);

const SESSION_ACTIONS: SessionAction[] = ["start", "pause", "resume", "skip", "endSession", "reset"];

const sessionActionSchema = z.object({
  action: z.enum(SESSION_ACTIONS as [SessionAction, ...SessionAction[]]),
  focusDurationSec: z.number().int().min(MIN_DURATION_SECONDS).optional(),
  breakDurationSec: z.number().int().min(MIN_DURATION_SECONDS).optional(),
});

roomsRouter.post("/:roomId/session", requireAuth, requireRoomRole("ADMIN"), async (req, res) => {
  const parsed = sessionActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
    return;
  }

  const session = await prisma.pomodoroSession.findUnique({ where: { roomId: req.params.roomId } });
  if (!session) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  const { action, focusDurationSec, breakDurationSec } = parsed.data;
  const result = applyAction(session as PomodoroSession, action, new Date(), {
    focusDurationSec,
    breakDurationSec,
  });
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }

  await prisma.pomodoroSession.update({ where: { roomId: req.params.roomId }, data: result.patch });
  const room = await resolveAndLoadRoom(req.params.roomId);
  void broadcastRoomUpdate(req.params.roomId);
  res.json({ room: serializeRoom(room!) });
});

const mediaSchema = z
  .object({ cameraOn: z.boolean().optional(), micOn: z.boolean().optional() })
  .refine((data) => data.cameraOn !== undefined || data.micOn !== undefined, {
    message: "Provide cameraOn and/or micOn.",
  });

roomsRouter.patch("/:roomId/media", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
  const parsed = mediaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input." });
    return;
  }

  await prisma.participant.update({
    where: { roomId_userId: { roomId: req.params.roomId, userId: req.user!.id } },
    data: parsed.data,
  });
  const room = await resolveAndLoadRoom(req.params.roomId);
  void broadcastRoomUpdate(req.params.roomId);
  res.json({ room: serializeRoom(room!) });
});
