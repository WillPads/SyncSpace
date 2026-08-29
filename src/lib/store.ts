import { randomUUID } from "crypto";
import { AVATAR_COLORS } from "@/lib/avatar";
import {
  EMPTY_ROOM_TTL_MS,
  FOCUS_DURATION_SECONDS,
  STALE_AWAY_MS,
  STALE_REMOVE_MS,
  durationForMode,
  nextMode,
} from "@/lib/time";
import type { Participant, ParticipantStatus, Room, TimerState } from "@/lib/types";

const ROOM_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;

type RoomsStore = Map<string, Room>;

// Survives Next.js dev-server hot reloads, which otherwise reset module-level state.
const globalStore = globalThis as unknown as {
  __syncspaceRooms?: RoomsStore;
  __syncspaceSweepStarted?: boolean;
};

const rooms: RoomsStore = globalStore.__syncspaceRooms ?? new Map();
globalStore.__syncspaceRooms = rooms;

if (!globalStore.__syncspaceSweepStarted) {
  globalStore.__syncspaceSweepStarted = true;
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      pruneParticipants(room, now);
      if (room.participants.length === 0 && now - room.createdAt > EMPTY_ROOM_TTL_MS) {
        rooms.delete(id);
      }
    }
  }, 60_000);
  sweep.unref?.();
}

export type StoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export type TimerAction = "start" | "pause" | "skip";

function normalizeRoomId(id: string): string {
  return id.trim().toUpperCase();
}

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARSET[Math.floor(Math.random() * ROOM_CODE_CHARSET.length)];
  }
  return code;
}

function uniqueRoomCode(): string {
  let code = generateRoomCode();
  while (rooms.has(code)) {
    code = generateRoomCode();
  }
  return code;
}

function createTimer(now: number): TimerState {
  return {
    mode: "focus",
    durationSeconds: FOCUS_DURATION_SECONDS,
    remainingSeconds: FOCUS_DURATION_SECONDS,
    isRunning: false,
    updatedAt: now,
    sessionsCompleted: 0,
  };
}

function resolveTimer(timer: TimerState, now: number): TimerState {
  if (!timer.isRunning) return timer;

  let mode = timer.mode;
  let durationSeconds = timer.durationSeconds;
  let sessionsCompleted = timer.sessionsCompleted;
  let remaining = timer.remainingSeconds - (now - timer.updatedAt) / 1000;

  let guard = 0;
  while (remaining <= 0 && guard < 1000) {
    if (mode === "focus") sessionsCompleted += 1;
    mode = nextMode(mode);
    durationSeconds = durationForMode(mode);
    remaining += durationSeconds;
    guard += 1;
  }

  return {
    mode,
    durationSeconds,
    remainingSeconds: remaining,
    isRunning: true,
    updatedAt: now,
    sessionsCompleted,
  };
}

function deriveParticipantStatus(participant: Participant, timer: TimerState, now: number): ParticipantStatus {
  if (now - participant.lastSeenAt > STALE_AWAY_MS) return "away";
  if (!timer.isRunning) return "idle";
  return timer.mode === "focus" ? "focused" : "on-break";
}

function pruneParticipants(room: Room, now: number): void {
  room.participants = room.participants.filter((p) => now - p.lastSeenAt <= STALE_REMOVE_MS);
}

function settleRoom(room: Room, now: number): Room {
  room.timer = resolveTimer(room.timer, now);
  pruneParticipants(room, now);
  for (const participant of room.participants) {
    participant.status = deriveParticipantStatus(participant, room.timer, now);
  }
  return room;
}

function sanitizeName(input: string | undefined, fallback: string): string {
  const trimmed = (input ?? "").trim().slice(0, 40);
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeTask(input: string | undefined): string {
  return (input ?? "").trim().slice(0, 120);
}

export function createRoom(options: {
  roomName?: string;
  hostName?: string;
  task?: string;
}): { room: Room; participantId: string } {
  const now = Date.now();
  const id = uniqueRoomCode();
  const participantId = randomUUID();
  const hostName = sanitizeName(options.hostName, "Host");

  const host: Participant = {
    id: participantId,
    name: hostName,
    colorIndex: 0,
    status: "idle",
    task: sanitizeTask(options.task) || "Getting settled in",
    isHost: true,
    joinedAt: now,
    lastSeenAt: now,
  };

  const room: Room = {
    id,
    name: sanitizeName(options.roomName, `${hostName}'s Room`),
    createdAt: now,
    hostId: participantId,
    timer: createTimer(now),
    participants: [host],
  };

  rooms.set(id, room);
  return { room: settleRoom(room, now), participantId };
}

export function joinRoom(
  id: string,
  name: string,
  task: string
): StoreResult<{ room: Room; participantId: string }> {
  const now = Date.now();
  const room = rooms.get(normalizeRoomId(id));
  if (!room) {
    return { ok: false, status: 404, error: "Room not found. Double-check the code and try again." };
  }

  settleRoom(room, now);

  const participantId = randomUUID();
  const participant: Participant = {
    id: participantId,
    name: sanitizeName(name, "Guest"),
    colorIndex: room.participants.length % AVATAR_COLORS.length,
    status: "idle",
    task: sanitizeTask(task) || "Just joined",
    isHost: false,
    joinedAt: now,
    lastSeenAt: now,
  };

  room.participants.push(participant);
  settleRoom(room, now);

  return { ok: true, data: { room, participantId } };
}

export function getResolvedRoom(id: string, participantId: string | null): StoreResult<Room> {
  const now = Date.now();
  const room = rooms.get(normalizeRoomId(id));
  if (!room) {
    return { ok: false, status: 404, error: "Room not found." };
  }

  if (participantId) {
    const participant = room.participants.find((p) => p.id === participantId);
    if (participant) participant.lastSeenAt = now;
  }

  settleRoom(room, now);
  return { ok: true, data: room };
}

export function applyTimerAction(id: string, action: TimerAction, participantId: string): StoreResult<Room> {
  const now = Date.now();
  const room = rooms.get(normalizeRoomId(id));
  if (!room) {
    return { ok: false, status: 404, error: "Room not found." };
  }

  settleRoom(room, now);

  if (room.hostId !== participantId) {
    return { ok: false, status: 403, error: "Only the host can control the timer." };
  }

  if (action === "start") {
    room.timer.isRunning = true;
    room.timer.updatedAt = now;
  } else if (action === "pause") {
    room.timer.isRunning = false;
    room.timer.updatedAt = now;
  } else if (action === "skip") {
    if (room.timer.mode === "focus") room.timer.sessionsCompleted += 1;
    const mode = nextMode(room.timer.mode);
    room.timer.mode = mode;
    room.timer.durationSeconds = durationForMode(mode);
    room.timer.remainingSeconds = durationForMode(mode);
    room.timer.updatedAt = now;
  }

  const participant = room.participants.find((p) => p.id === participantId);
  if (participant) participant.lastSeenAt = now;

  settleRoom(room, now);
  return { ok: true, data: room };
}

export function updateParticipantTask(id: string, participantId: string, task: string): StoreResult<Room> {
  const now = Date.now();
  const room = rooms.get(normalizeRoomId(id));
  if (!room) {
    return { ok: false, status: 404, error: "Room not found." };
  }

  const participant = room.participants.find((p) => p.id === participantId);
  if (!participant) {
    return { ok: false, status: 404, error: "You are not part of this room." };
  }

  participant.task = sanitizeTask(task) || participant.task;
  participant.lastSeenAt = now;
  settleRoom(room, now);
  return { ok: true, data: room };
}
