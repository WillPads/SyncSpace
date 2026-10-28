"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ChatMessage, type ChatPage, chatApi, friendlyError } from "@/lib/api";
import type { RoomEventListener } from "@/hooks/useLiveRoom";

/**
 * Room chat state. The design in one paragraph: writes (send, delete) and history go over REST;
 * the WebSocket only pushes what other people did. Because the server sends a new message to
 * everyone including its author, the same message can arrive twice (POST response and push), so
 * every insert is deduplicated by message id. The socket does not replay frames missed while it
 * was down, so on every "hello" (first connect and every reconnect) the newest page is fetched
 * again and merged in.
 */

interface Thread {
  messages: ChatMessage[]; // oldest first
  nextBefore: string | null; // cursor for "Load earlier"; null when everything is loaded
}

export type ChatStatus = "loading" | "ready" | "error";

const EMPTY: Thread = { messages: [], nextBefore: null };

/** The server orders messages by (createdAt, id); sorting the same way keeps both sides in step. */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function insertMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (list.some((m) => m.id === message.id)) return list;
  const last = list[list.length - 1];
  // Usual case: it is the newest message, so just append.
  if (!last || compareMessages(last, message) < 0) return [...list, message];
  return [...list, message].sort(compareMessages);
}

/**
 * Folds a freshly fetched newest page into what is already on screen.
 * - Messages that overlap the page are replaced by the server's copy.
 * - If the page overlaps what we have, the older history we already loaded is kept (and so is its cursor).
 * - If it does not overlap (we were away long enough to miss a whole page), the old list is dropped,
 *   because keeping it would leave a hole in the middle.
 * - Messages that arrived over the socket while the request was in flight (newer than the page) are kept.
 */
function mergeLatest(prev: Thread, page: ChatPage, isDeleted: (id: string) => boolean): Thread {
  const fresh = page.messages.filter((m) => !isDeleted(m.id));
  const first = fresh[0];
  const last = fresh[fresh.length - 1];
  const freshIds = new Set(fresh.map((m) => m.id));
  const tail = last ? prev.messages.filter((m) => !freshIds.has(m.id) && compareMessages(m, last) > 0) : [];

  if (first && prev.messages.some((m) => freshIds.has(m.id))) {
    const older = prev.messages.filter((m) => compareMessages(m, first) < 0);
    return { messages: [...older, ...fresh, ...tail], nextBefore: older.length > 0 ? prev.nextBefore : page.nextBefore };
  }
  return { messages: [...fresh, ...tail], nextBefore: page.nextBefore };
}

export function useRoomChat(roomId: string, subscribe: (listener: RoomEventListener) => () => void) {
  const [thread, setThread] = useState<Thread>(EMPTY);
  const [status, setStatus] = useState<ChatStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  // Ids deleted during this visit. A fetch that started before a delete can still return the
  // message, and without this list it would pop back onto the screen.
  const deleted = useRef(new Set<string>());
  const alive = useRef(true);
  const isDeleted = useCallback((id: string) => deleted.current.has(id), []);

  const addMessage = useCallback((message: ChatMessage) => {
    if (deleted.current.has(message.id)) return;
    setThread((prev) => {
      const messages = insertMessage(prev.messages, message);
      return messages === prev.messages ? prev : { ...prev, messages };
    });
  }, []);

  const dropMessage = useCallback((messageId: string) => {
    deleted.current.add(messageId);
    setThread((prev) =>
      prev.messages.some((m) => m.id === messageId)
        ? { ...prev, messages: prev.messages.filter((m) => m.id !== messageId) }
        : prev
    );
  }, []);

  /** Fetch the newest page. `replace` throws away what is on screen first (used after a stale cursor). */
  const refresh = useCallback(
    async (replace = false) => {
      try {
        const page = await chatApi.list(roomId);
        if (!alive.current) return;
        setThread((prev) =>
          replace
            ? { messages: page.messages.filter((m) => !deleted.current.has(m.id)), nextBefore: page.nextBefore }
            : mergeLatest(prev, page, isDeleted)
        );
        setLoadError(null);
        setStatus("ready");
      } catch (err) {
        if (!alive.current) return;
        // A failed refresh while chat is already on screen is silent: the next "hello" tries again.
        setStatus((current) => (current === "ready" ? current : "error"));
        setLoadError(friendlyError(err));
      }
    },
    [roomId, isDeleted]
  );

  useEffect(() => {
    alive.current = true;
    deleted.current = new Set();
    setThread(EMPTY);
    setStatus("loading");
    setLoadError(null);
    void refresh();

    const unsubscribe = subscribe((event) => {
      switch (event.type) {
        case "hello":
          void refresh();
          break;
        case "chat:message":
          addMessage(event.message);
          break;
        case "chat:deleted":
          dropMessage(event.messageId);
          break;
      }
    });
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [roomId, subscribe, refresh, addMessage, dropMessage]);

  const retry = useCallback(() => {
    setStatus("loading");
    void refresh();
  }, [refresh]);

  const loadOlder = useCallback(async () => {
    const cursor = thread.nextBefore;
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await chatApi.list(roomId, { before: cursor });
      if (!alive.current) return;
      setThread((prev) => {
        // If a refresh replaced the list while this request was running, the cursor no longer
        // fits what is on screen; adding the page would leave a gap, so drop it.
        if (prev.nextBefore !== cursor) return prev;
        const have = new Set(prev.messages.map((m) => m.id));
        const older = page.messages.filter((m) => !have.has(m.id) && !deleted.current.has(m.id));
        return { messages: [...older, ...prev.messages], nextBefore: page.nextBefore };
      });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.status === 400) {
        // INVALID_CURSOR: that message was pruned (the server keeps the newest 500). Start over from the newest page.
        await refresh(true);
      } else {
        setOlderError(friendlyError(err));
      }
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  }, [thread.nextBefore, loadingOlder, roomId, refresh]);

  /** Throws the API error on failure so the composer can keep the text and show it. */
  const send = useCallback(
    async (body: string) => {
      addMessage(await chatApi.send(roomId, body));
    },
    [roomId, addMessage]
  );

  /** Optimistic: the message disappears at once and comes back if the server refuses. */
  const remove = useCallback(
    async (messageId: string) => {
      const target = thread.messages.find((m) => m.id === messageId);
      if (!target) return;
      dropMessage(messageId);
      try {
        await chatApi.remove(roomId, messageId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return; // already gone, which is what we wanted
        deleted.current.delete(messageId);
        addMessage(target);
        throw err;
      }
    },
    [thread.messages, roomId, dropMessage, addMessage]
  );

  return {
    messages: thread.messages,
    hasOlder: thread.nextBefore !== null,
    status,
    loadError,
    loadingOlder,
    olderError,
    retry,
    loadOlder,
    send,
    remove,
  };
}
