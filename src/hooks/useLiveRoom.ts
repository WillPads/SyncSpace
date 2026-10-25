"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { openRoomSocket } from "@/lib/serverConfig";
import type { Room } from "@/lib/types";

type ServerMessage =
  | { type: "room:update"; room: Room }
  | { type: "presence:sync"; onlineUserIds: string[] }
  | { type: "presence:joined" | "presence:left"; userId: string }
  | { type: "quiz:ready"; documentId: string; quizId: string };

export type Connection = "connecting" | "live" | "reconnecting";

// Losing membership (or the session) is final; anything else is worth retrying.
const FINAL_STATUSES = new Set([401, 403, 404]);

/**
 * The room as the server sees it: a REST snapshot, then live pushes over the room
 * WebSocket (server/src/ws). `receivedAt` is when this client got the snapshot, which
 * is what the countdown is measured from (see liveRemaining in lib/timer.ts).
 */
export function useLiveRoom(roomId: string) {
  const [snapshot, setSnapshot] = useState<{ room: Room; receivedAt: number } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [online, setOnline] = useState<ReadonlySet<string>>(() => new Set());
  const [connection, setConnection] = useState<Connection>("connecting");
  const [quizVersion, setQuizVersion] = useState(0);

  const applyRoom = useCallback((room: Room) => setSnapshot({ room, receivedAt: Date.now() }), []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    function handle(message: ServerMessage) {
      switch (message.type) {
        case "room:update":
          applyRoom(message.room);
          break;
        case "presence:sync":
          setOnline(new Set(message.onlineUserIds));
          break;
        case "presence:joined":
          setOnline((prev) => new Set(prev).add(message.userId));
          break;
        case "presence:left":
          setOnline((prev) => {
            const next = new Set(prev);
            next.delete(message.userId);
            return next;
          });
          break;
        case "quiz:ready":
          setQuizVersion((v) => v + 1);
          break;
      }
    }

    function scheduleRetry() {
      const delay = Math.min(10_000, 1000 * 2 ** attempt++);
      retryTimer = setTimeout(() => void start(), delay);
    }

    async function connect() {
      const ws = await openRoomSocket(roomId);
      if (disposed) {
        ws.close();
        return;
      }
      socket = ws;
      socket.onopen = () => {
        attempt = 0;
        setConnection("live");
      };
      socket.onmessage = (event) => {
        try {
          handle(JSON.parse(String(event.data)) as ServerMessage);
        } catch {
          // Ignore anything that isn't a message we know.
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        setConnection("reconnecting");
        scheduleRetry();
      };
    }

    // Reload over REST before every (re)connect: it gives a snapshot even while the
    // socket is down, and a 403 here is how a removed participant finds out.
    async function start() {
      try {
        const room = await api.getRoom(roomId);
        if (disposed) return;
        applyRoom(room);
        setError(null);
        await connect();
      } catch (err) {
        if (disposed) return;
        const apiError = err instanceof ApiError ? err : new ApiError("Something went wrong.", 0);
        setError(apiError);
        if (FINAL_STATUSES.has(apiError.status)) return;
        setConnection("reconnecting");
        scheduleRetry();
      }
    }

    void start();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [roomId, applyRoom]);

  return {
    room: snapshot?.room ?? null,
    receivedAt: snapshot?.receivedAt ?? 0,
    error,
    online,
    connection,
    quizVersion,
    applyRoom,
  };
}
