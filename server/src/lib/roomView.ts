import type { PomodoroSession, Prisma, Role, SessionState } from "@prisma/client";
import { prisma } from "../db.js";
import { phaseEndsAt, resolveSession } from "./fsm.js";

export const roomInclude = {
  session: true,
  // Explicit order: Postgres returns rows in no particular order, and an unordered list
  // would reshuffle in the UI after unrelated updates.
  participants: {
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    include: { user: { select: { id: true, displayName: true } } },
  },
} satisfies Prisma.RoomInclude;

export type RoomWithRelations = Prisma.RoomGetPayload<{ include: typeof roomInclude }>;

export interface SerializedSession {
  id: string;
  roomId: string;
  state: SessionState;
  focusDurationSec: number;
  breakDurationSec: number;
  /** Seconds left in the current phase, as of `updatedAt`. */
  remainingSeconds: number;
  isRunning: boolean;
  updatedAt: string;
  /** When the current phase ends (server clock), or null when not running. */
  endsAt: string | null;
  sessionsCompleted: number;
  version: number;
}

export interface SerializedParticipant {
  userId: string;
  displayName: string;
  role: Role;
  task: string;
  joinedAt: string;
  cameraOn: boolean;
  micOn: boolean;
}

export interface SerializedRoom {
  id: string;
  code: string;
  name: string;
  adminId: string;
  inviteEnabled: boolean;
  capacity: number;
  session: SerializedSession | null;
  participants: SerializedParticipant[];
  /** Server clock when this snapshot was taken; clients can use it to estimate clock offset. */
  serverTime: string;
}

export function serializeSession(session: PomodoroSession, now = new Date()): SerializedSession {
  const live = { ...session, ...resolveSession(session, now) };
  const endsAt = phaseEndsAt(live);
  return {
    id: live.id,
    roomId: live.roomId,
    state: live.state,
    focusDurationSec: live.focusDurationSec,
    breakDurationSec: live.breakDurationSec,
    remainingSeconds: live.remainingSeconds,
    isRunning: live.isRunning,
    updatedAt: live.updatedAt.toISOString(),
    endsAt: endsAt ? endsAt.toISOString() : null,
    sessionsCompleted: live.sessionsCompleted,
    version: live.version,
  };
}

/** The one shape a room has everywhere: REST responses and WebSocket pushes alike. */
export function serializeRoom(room: RoomWithRelations, now = new Date()): SerializedRoom {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    adminId: room.adminId,
    inviteEnabled: room.inviteEnabled,
    capacity: room.capacity,
    session: room.session ? serializeSession(room.session, now) : null,
    participants: room.participants.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      role: p.role,
      task: p.task,
      joinedAt: p.joinedAt.toISOString(),
      cameraOn: p.cameraOn,
      micOn: p.micOn,
    })),
    serverTime: now.toISOString(),
  };
}

export function loadRoom(roomId: string): Promise<RoomWithRelations | null> {
  return prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
}
