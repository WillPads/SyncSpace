"use client";

import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChatComposer } from "@/components/room/ChatComposer";
import { ChatMessageItem } from "@/components/room/ChatMessageItem";
import { Icon } from "@/components/ui/Icon";
import type { RoomEventListener } from "@/hooks/useLiveRoom";
import { compareMessages, useRoomChat } from "@/hooks/useRoomChat";
import { type ChatMessage, friendlyError } from "@/lib/api";

// Within this many pixels of the bottom counts as "at the bottom" (sub-pixel rounding, tiny drifts).
const BOTTOM_SLACK = 32;
// Messages that arrive within this window are announced to screen readers as one sentence.
const ANNOUNCE_DELAY_MS = 800;

/**
 * Room chat tile. The data and the realtime plumbing live in useRoomChat; this component is
 * the scroll behaviour (stay at the bottom only if you are there), the screen-reader
 * announcements, and the markup.
 */
export function ChatTile({
  roomId,
  userId,
  isAdmin,
  subscribe,
}: {
  roomId: string;
  userId: string;
  isAdmin: boolean;
  subscribe: (listener: RoomEventListener) => () => void;
}) {
  const chat = useRoomChat(roomId, subscribe);
  const { messages, status, hasOlder } = chat;
  const logRef = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // --- Scrolling -----------------------------------------------------------------------------
  // stick: the user is looking at the newest message, so new ones should keep it in view.
  const stick = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const last = useRef<{ firstId?: string; newest?: ChatMessage; height: number }>({ height: 0 });

  // Runs after the new messages are in the DOM but before the browser paints, so nothing flickers.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const before = last.current;
    const newest = messages[messages.length - 1];
    const appended = !!newest && (!before.newest || compareMessages(newest, before.newest) > 0);
    const prepended =
      !appended && before.firstId !== undefined && messages[0]?.id !== before.firstId && messages.some((m) => m.id === before.firstId);

    if (appended) {
      if (stick.current || newest.userId === userId) {
        // At the bottom already (or you just sent it): follow the conversation.
        log.scrollTop = log.scrollHeight;
        stick.current = true;
        setUnseen(false);
      } else {
        // Reading older messages: don't yank the view, offer a button instead.
        setUnseen(true);
      }
    } else if (prepended) {
      // "Load earlier" added rows above the view. Push the scroll position down by their height so the
      // message you were reading stays exactly where it was.
      log.scrollTop += log.scrollHeight - before.height;
    }
    last.current = { firstId: messages[0]?.id, newest: newest ?? before.newest, height: log.scrollHeight };
  }, [messages, userId]);

  // The list's box changes with the window (rotating a phone, resizing, switching view): if you were
  // at the bottom, stay there instead of ending up with the newest message cut off.
  useEffect(() => {
    const log = logRef.current;
    if (!log || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stick.current) log.scrollTop = log.scrollHeight;
    });
    observer.observe(log);
    return () => observer.disconnect();
  }, []);

  function handleScroll() {
    const log = logRef.current;
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < BOTTOM_SLACK;
    stick.current = atBottom;
    if (atBottom) setUnseen(false);
  }

  function jumpToNewest() {
    const log = logRef.current;
    if (!log) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    log.scrollTo({ top: log.scrollHeight, behavior: calm ? "auto" : "smooth" });
    stick.current = true;
    setUnseen(false);
  }

  // --- Screen-reader announcements -----------------------------------------------------------
  // The message list itself is not a live region (it would read out the whole history on load and
  // on "Load earlier"). A hidden one speaks only messages from other people that arrive after the
  // first load, batched so a burst is one sentence instead of one interruption each.
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef<ChatMessage | null | undefined>(undefined); // undefined until the first load
  const pending = useRef<ChatMessage[]>([]);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (status !== "ready") return;
    const newest = messages[messages.length - 1] ?? null;
    const seen = announced.current;
    if (seen === undefined) {
      announced.current = newest;
      return;
    }
    const isNewer = (m: ChatMessage) => seen === null || compareMessages(m, seen) > 0;
    const fresh = messages.filter((m) => isNewer(m) && m.userId !== userId);
    if (newest && isNewer(newest)) announced.current = newest;
    if (fresh.length === 0) return;
    pending.current.push(...fresh);
    clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => {
      const batch = pending.current;
      pending.current = [];
      const latest = batch[batch.length - 1];
      setAnnouncement(
        batch.length === 1
          ? `${latest.displayName}: ${latest.body}`
          : `${batch.length} new messages, the latest from ${latest.displayName}`
      );
      // Empty the region afterwards so an identical sentence later is announced again.
      clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setAnnouncement(""), 5000);
    }, ANNOUNCE_DELAY_MS);
  }, [messages, status, userId]);

  useEffect(
    () => () => {
      clearTimeout(announceTimer.current);
      clearTimeout(clearTimer.current);
    },
    []
  );

  // --- Focus ---------------------------------------------------------------------------------
  // The message list gets focus from code after a delete. Browsers then draw the focus ring even
  // though the person used a mouse. data-input records the last input kind, and room.css hides
  // the ring unless it is "keyboard", so only keyboard users see it.
  useEffect(() => {
    const mark = (kind: "keyboard" | "pointer") => () => {
      if (logRef.current) logRef.current.dataset.input = kind;
    };
    const onKey = mark("keyboard");
    const onPointer = mark("pointer");
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  // Deleting a message, or loading the last page, removes the button that had focus. Park focus on
  // the message list instead of letting it fall back to the top of the page.
  const hadOlder = useRef(false);
  useEffect(() => {
    if (!hasOlder && hadOlder.current && document.activeElement === document.body) logRef.current?.focus();
    hadOlder.current = hasOlder;
  }, [hasOlder]);

  // --- Actions -------------------------------------------------------------------------------
  const { send, remove } = chat;

  const handleSend = useCallback(
    async (body: string) => {
      setActionError(null);
      try {
        await send(body);
      } catch (err) {
        setActionError(friendlyError(err));
        throw err; // lets the composer keep the text
      }
    },
    [send]
  );

  const handleDelete = useCallback(
    (messageId: string) => {
      setActionError(null);
      logRef.current?.focus();
      remove(messageId).catch((err) => setActionError(`Couldn't delete that message. ${friendlyError(err)}`));
    },
    [remove]
  );

  return (
    <section className="tile rm-card rm-chat" aria-labelledby="rm-chat-h">
      <header className="rm-card-head">
        <h2 id="rm-chat-h">Chat</h2>
        <span className="rm-count">Everyone in this room can read it</span>
      </header>

      <div className="rm-chat-wrap">
        {/* tabIndex 0: a scrolling area must be reachable and scrollable from the keyboard. */}
        <div ref={logRef} className="rm-chat-log" role="region" aria-label="Chat messages" tabIndex={0} onScroll={handleScroll}>
          {status === "loading" && (
            <p className="rm-note rm-chat-state" role="status">
              Loading messages…
            </p>
          )}
          {status === "error" && (
            <div className="rm-chat-state">
              <p className="form-err" role="alert">
                Couldn&apos;t load the chat. {chat.loadError}
              </p>
              <button className="btn btn-secondary" type="button" onClick={chat.retry}>
                Try again
              </button>
            </div>
          )}
          {status === "ready" && messages.length === 0 && (
            <div className="empty rm-chat-state">
              <p>
                <b>No messages yet</b>
              </p>
              <p>Say hello. Everyone in the room will see it.</p>
            </div>
          )}
          {status === "ready" && hasOlder && (
            // aria-disabled (not disabled) while loading, so keyboard focus is not dropped mid-request.
            <button
              className="btn btn-secondary rm-chat-older"
              type="button"
              aria-disabled={chat.loadingOlder}
              onClick={() => void chat.loadOlder()}
            >
              {chat.loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          )}
          {chat.olderError && (
            <p className="field-err" role="alert">
              Couldn&apos;t load earlier messages. {chat.olderError}
            </p>
          )}
          {messages.length > 0 && (
            <ol className="rm-chat-list">
              {messages.map((message) => {
                const mine = message.userId === userId;
                return (
                  <ChatMessageItem
                    key={message.id}
                    message={message}
                    mine={mine}
                    canDelete={mine || isAdmin}
                    onDelete={handleDelete}
                  />
                );
              })}
            </ol>
          )}
        </div>
        {unseen && (
          <button className="btn btn-primary rm-chat-jump" type="button" onClick={jumpToNewest}>
            New messages
            <Icon icon={ArrowDown} />
          </button>
        )}
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <ChatComposer onSend={handleSend} error={actionError} onEdit={() => setActionError(null)} />
    </section>
  );
}
