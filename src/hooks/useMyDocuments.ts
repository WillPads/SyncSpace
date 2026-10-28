"use client";

import { useState } from "react";
import useSWR from "swr";
import { ApiError, type DashboardFile, dashboardApi, isProcessing } from "@/lib/api";

const FILES_KEY = "me/documents";
const FILES_LIMIT = 6;
const POLL_MS = 2000;

/**
 * "Recent files": the latest uploads across the user's rooms.
 *
 * Polling: the dashboard has no WebSocket, so while any file is still PENDING/PARSING we re-ask
 * the server every 2 s, and stop (interval 0) as soon as every file is READY or FAILED. Idle
 * dashboards therefore make no repeated requests. The interval is React state, set from the
 * latest response in `onSuccess`: SWR only re-reads a *function* interval while its timer is
 * already running, so a state value is what restarts polling after a fresh upload.
 */
export function useMyDocuments() {
  const [pollMs, setPollMs] = useState(0);
  const { data, error, mutate } = useSWR<DashboardFile[], ApiError>(FILES_KEY, () => dashboardApi.listMyDocuments(FILES_LIMIT), {
    refreshInterval: pollMs,
    onSuccess: (latest) => setPollMs(latest.some((file) => isProcessing(file.status)) ? POLL_MS : 0),
  });

  /** Deletes a file. Optimistic removal; if the server refuses (403: not yours) it reappears. */
  async function remove(file: DashboardFile) {
    const without = (current: DashboardFile[] = []) => current.filter((f) => f.id !== file.id);
    await mutate(
      async (current) => {
        try {
          await dashboardApi.deleteDocument(file.roomId, file.id);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
        return without(current);
      },
      { optimisticData: without, rollbackOnError: true, revalidate: false }
    );
  }

  return { files: data, error, isLoading: !data && !error, remove, refresh: () => mutate(), retry: () => mutate() };
}

export type MyDocuments = ReturnType<typeof useMyDocuments>;
