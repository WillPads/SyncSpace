"use client";

import { useCallback, useRef } from "react";
import useSWR, { type KeyedMutator } from "swr";
import { ApiError, fetchRoom, setTimerActionRequest, updateTaskRequest } from "@/lib/api-client";
import type { Room } from "@/lib/types";

export function useRoom(roomId: string | null, participantId: string | null) {
  const participantIdRef = useRef(participantId);
  participantIdRef.current = participantId;

  const { data, error, isLoading, mutate } = useSWR<Room, ApiError>(
    roomId,
    (id: string) => fetchRoom(id, participantIdRef.current).then((res) => res.room),
    {
      refreshInterval: 2000,
      revalidateOnFocus: true,
      dedupingInterval: 400,
    }
  );

  const applyMutation = useCallback(
    (mutator: KeyedMutator<Room>, room: Room) => mutator(room, { revalidate: false }),
    []
  );

  const start = useCallback(async () => {
    if (!roomId || !participantId) return;
    const res = await setTimerActionRequest(roomId, "start", participantId);
    await applyMutation(mutate, res.room);
  }, [roomId, participantId, mutate, applyMutation]);

  const pause = useCallback(async () => {
    if (!roomId || !participantId) return;
    const res = await setTimerActionRequest(roomId, "pause", participantId);
    await applyMutation(mutate, res.room);
  }, [roomId, participantId, mutate, applyMutation]);

  const skip = useCallback(async () => {
    if (!roomId || !participantId) return;
    const res = await setTimerActionRequest(roomId, "skip", participantId);
    await applyMutation(mutate, res.room);
  }, [roomId, participantId, mutate, applyMutation]);

  const updateTask = useCallback(
    async (task: string) => {
      if (!roomId || !participantId) return;
      const res = await updateTaskRequest(roomId, participantId, task);
      await applyMutation(mutate, res.room);
    },
    [roomId, participantId, mutate, applyMutation]
  );

  return {
    room: data ?? null,
    isLoading,
    error: error instanceof ApiError ? error.message : error ? "Something went wrong." : null,
    notFound: error instanceof ApiError && error.status === 404,
    start,
    pause,
    skip,
    updateTask,
    refresh: mutate,
  };
}
