import { loadRoom, serializeRoom, type RoomWithRelations } from "../lib/roomView.js";
import { connectedRoomIds, hasClients, sendToRoom } from "./registry.js";

/**
 * Live room state for connected clients.
 *
 * Every change goes through `publishRoom`, which reloads the room from the database,
 * caches it, and pushes it to the room. The sync pulse (every WS_TICK_MS) then re-sends
 * the cached room with the timer re-derived from the server clock, so pulses cost no
 * database queries; the cache is refreshed from the database at most every
 * SNAPSHOT_MAX_AGE_MS as a safety net.
 */
const SNAPSHOT_MAX_AGE_MS = 30_000;

interface Snapshot {
  room: RoomWithRelations;
  loadedAt: number;
  seq: number;
}

const snapshots = new Map<string, Snapshot>();
const pulseRefreshes = new Set<string>();
let loadSeq = 0;

/**
 * Loads `roomId` and stores it unless a load that started later already landed (a slow,
 * older read must never overwrite a newer one). `current` says whether this load is the
 * newest one stored, i.e. whether it's safe to broadcast.
 */
async function loadLatest(roomId: string): Promise<{ room: RoomWithRelations | null; current: boolean }> {
  const seq = ++loadSeq;
  const room = await loadRoom(roomId);
  const stored = snapshots.get(roomId);
  if (stored && stored.seq > seq) return { room, current: false };
  if (!room) {
    snapshots.delete(roomId);
    return { room: null, current: true };
  }
  if (hasClients(roomId)) snapshots.set(roomId, { room, loadedAt: Date.now(), seq });
  return { room, current: true };
}

/** Reloads a room after a change and pushes it to everyone connected. Returns the fresh room. */
export async function publishRoom(roomId: string): Promise<RoomWithRelations | null> {
  const { room, current } = await loadLatest(roomId);
  if (room && current) sendToRoom(roomId, { type: "room:update", room: serializeRoom(room) });
  return room;
}

/** Fire-and-forget variant for places that can't await (socket events, background jobs). */
export function publishRoomInBackground(roomId: string): void {
  publishRoom(roomId).catch((err: unknown) => console.error(`Failed to publish room ${roomId}:`, err));
}

export function forgetRoom(roomId: string): void {
  snapshots.delete(roomId);
}

/** One sync pulse: re-send each connected room's cached state with the timer as of now. */
export function pulseRooms(now = new Date()): void {
  for (const roomId of connectedRoomIds()) {
    const snapshot = snapshots.get(roomId);
    const stale = !snapshot || now.getTime() - snapshot.loadedAt >= SNAPSHOT_MAX_AGE_MS;
    if (stale && !pulseRefreshes.has(roomId)) {
      pulseRefreshes.add(roomId);
      publishRoom(roomId)
        .catch((err: unknown) => console.error(`Failed to refresh room ${roomId}:`, err))
        .finally(() => pulseRefreshes.delete(roomId));
    }
    if (snapshot) sendToRoom(roomId, { type: "room:update", room: serializeRoom(snapshot.room, now) });
  }
  for (const roomId of snapshots.keys()) {
    if (!hasClients(roomId)) snapshots.delete(roomId);
  }
}
