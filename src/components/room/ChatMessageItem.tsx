"use client";

import { Trash2 } from "lucide-react";
import { memo } from "react";
import { Icon } from "@/components/ui/Icon";
import type { ChatMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

/** "3:05 PM" for today, "Oct 27, 3:05 PM" for an earlier day. Local time of the viewer. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * One chat line. The body is rendered as a plain React text child, so any HTML or markdown a
 * sender types shows up literally instead of being interpreted (React escapes it).
 */
export const ChatMessageItem = memo(function ChatMessageItem({
  message,
  mine,
  canDelete,
  onDelete,
}: {
  message: ChatMessage;
  mine: boolean;
  canDelete: boolean;
  onDelete: (messageId: string) => void;
}) {
  return (
    <li className={cn("rm-msg", mine && "is-mine")}>
      <div className="rm-msg-main">
        <p className="rm-msg-meta">
          <b className="rm-msg-who">{mine ? "You" : message.displayName}</b>
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        </p>
        <p className="rm-msg-body">{message.body}</p>
      </div>
      {canDelete && (
        <button
          className="icon-btn rm-msg-del"
          type="button"
          aria-label={mine ? "Delete your message" : `Delete message from ${message.displayName}`}
          onClick={() => onDelete(message.id)}
        >
          <Icon icon={Trash2} size={16} />
        </button>
      )}
    </li>
  );
});
