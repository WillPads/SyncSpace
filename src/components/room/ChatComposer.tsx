"use client";

import { Send } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { CHAT_MAX_LENGTH } from "@/lib/api";
import { cn } from "@/lib/cn";

// The counter only shows up when the limit is getting close, so it isn't noise for short messages.
const COUNTER_FROM = 400;

/**
 * The message box. The text stays in the box until the server accepts it: if sending fails
 * (rate limit, network, removed from the room) nothing is lost and the user can just press Enter again.
 * Enter sends, Shift+Enter inserts a new line.
 */
export function ChatComposer({
  onSend,
  error,
  onEdit,
}: {
  onSend: (body: string) => Promise<void>;
  error: string | null;
  onEdit: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the text (up to ~4 lines, then it scrolls) and shrink back after sending.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 112)}px`;
  }, [draft]);

  // The server trims before checking the 1..500 rule, so count the trimmed text too.
  const body = draft.trim();
  const tooLong = body.length > CHAT_MAX_LENGTH;
  const showCounter = body.length >= COUNTER_FROM;
  const canSend = body.length > 0 && !tooLong && !sending;

  async function submit() {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(body);
      // Clear only if the user hasn't typed more while the request was running.
      setDraft((current) => (current.trim() === body ? "" : current));
    } catch {
      // The parent shows the error; the text stays in the box.
    } finally {
      setSending(false);
      fieldRef.current?.focus();
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter confirms an IME candidate (Japanese, Chinese...) and must not send.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form className="rm-chat-form" onSubmit={handleSubmit}>
      {error && (
        <p className="form-err" role="alert">
          {error}
        </p>
      )}
      <div className="rm-chat-row">
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <textarea
          ref={fieldRef}
          id="chat-message"
          className={cn("input rm-chat-input", tooLong && "is-invalid")}
          rows={1}
          placeholder="Message the room"
          autoComplete="off"
          value={draft}
          aria-describedby="chat-hint"
          aria-invalid={tooLong || undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) onEdit();
          }}
          onKeyDown={handleKeyDown}
        />
        <button className="btn btn-primary rm-chat-send" type="submit" disabled={!canSend}>
          <Icon icon={Send} />
          Send
        </button>
      </div>
      <p className="rm-chat-hint" id="chat-hint">
        <span>Enter to send, Shift+Enter for a new line.</span>
        {showCounter && (
          <span className={cn("rm-chat-count", tooLong && "is-over")}>
            {body.length}/{CHAT_MAX_LENGTH}
          </span>
        )}
      </p>
      {tooLong && (
        <p className="field-err" role="alert">
          Messages can be up to {CHAT_MAX_LENGTH} characters.
        </p>
      )}
    </form>
  );
}
