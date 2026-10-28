import { prisma } from "../db.js";

export const MIN_DURATION_MIN = 15;
export const MAX_DURATION_MIN = 240;
export const MAX_UPCOMING_PER_ROOM = 20;
/** How far ahead a session can be planned. */
export const MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;
/** Sessions are kept this long after they end, then removed the next time anyone reads or writes the calendar. */
const KEEP_AFTER_END_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

export function endsAt(session: { startsAt: Date; durationMin: number }): number {
  return session.startsAt.getTime() + session.durationMin * MINUTE_MS;
}

/** "Upcoming" includes a session that is happening right now: it counts until it ends. */
export async function upcomingSessions(roomIds: string[], now: Date, take?: number) {
  // Nothing lasts longer than MAX_DURATION_MIN, so anything still running or ahead started after this.
  const earliestStart = new Date(now.getTime() - MAX_DURATION_MIN * MINUTE_MS);
  const rows = await prisma.scheduledSession.findMany({
    where: { roomId: { in: roomIds }, startsAt: { gt: earliestStart } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    include: { room: { select: { name: true } } },
  });
  const upcoming = rows.filter((row) => endsAt(row) > now.getTime());
  return take === undefined ? upcoming : upcoming.slice(0, take);
}

/**
 * Housekeeping, done lazily instead of by a background job: removes sessions in these rooms that
 * ended more than a week ago. Scoped to the rooms being looked at so it can use the (roomId, startsAt) index.
 */
export async function pruneEndedSessions(roomIds: string[], now = new Date()): Promise<void> {
  if (roomIds.length === 0) return;
  const cutoff = now.getTime() - KEEP_AFTER_END_MS;
  const old = await prisma.scheduledSession.findMany({
    where: { roomId: { in: roomIds }, startsAt: { lt: new Date(cutoff) } },
    select: { id: true, startsAt: true, durationMin: true },
  });
  const stale = old.filter((row) => endsAt(row) < cutoff).map((row) => row.id);
  if (stale.length > 0) await prisma.scheduledSession.deleteMany({ where: { id: { in: stale } } });
}
