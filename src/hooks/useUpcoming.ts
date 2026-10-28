"use client";

import useSWR from "swr";
import { ApiError, type UpcomingSession, dashboardApi } from "@/lib/api";

const UPCOMING_KEY = "schedule/upcoming";

/**
 * Upcoming study sessions across the user's rooms (soonest first, in-progress ones included).
 * No polling: schedules change rarely, and SWR already refetches when the tab regains focus.
 * Our own changes go through `schedule` / `remove`, which update the list right away.
 */
export function useUpcoming() {
  const { data, error, mutate } = useSWR<UpcomingSession[], ApiError>(UPCOMING_KEY, () => dashboardApi.listUpcoming(10));

  /** Host-only. Waits for the server (it validates the time and the 20-per-room cap), then refetches the sorted list. */
  async function schedule(roomId: string, startsAt: Date, durationMin: number) {
    await dashboardApi.scheduleSession(roomId, { startsAt: startsAt.toISOString(), durationMin });
    await mutate();
  }

  /** Host-only. Optimistic removal with rollback if the server refuses. */
  async function remove(session: UpcomingSession) {
    const without = (current: UpcomingSession[] = []) => current.filter((s) => s.id !== session.id);
    await mutate(
      async (current) => {
        try {
          await dashboardApi.deleteScheduledSession(session.roomId, session.id);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
        return without(current);
      },
      { optimisticData: without, rollbackOnError: true, revalidate: false }
    );
  }

  return { sessions: data, error, isLoading: !data && !error, schedule, remove, retry: () => mutate() };
}
