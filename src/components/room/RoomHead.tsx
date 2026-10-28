"use client";

import { Copy, Lock, LockOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { LAYOUT_OPTIONS, type RoomLayout } from "@/components/room/layouts";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { Connection } from "@/hooks/useLiveRoom";
import type { Room } from "@/lib/types";

export function RoomHead({
  room,
  isAdmin,
  onlineCount,
  connection,
  layout,
  busy,
  onLayout,
  onToggleInvite,
  onLeave,
}: {
  room: Room;
  isAdmin: boolean;
  onlineCount: number;
  connection: Connection;
  layout: RoomLayout;
  busy: boolean;
  onLayout: (layout: RoomLayout) => void;
  onToggleInvite: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const host = room.participants.find((p) => p.role === "ADMIN")?.displayName ?? "the host";

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${room.code}`);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the code is still visible in the sync line.
    }
  }

  const live = connection === "live";

  return (
    <header className="rm-bar">
      <div className="rm-title">
        <h1>{room.name}</h1>
        <div className="rm-chips">
          <span className="chip" aria-live="polite">
            <span className={cn("rm-dot", !live && "is-offline")} aria-hidden />
            {live ? `Synced · ${onlineCount} online` : "Reconnecting…"}
          </span>
          <span className="chip">Host {host}</span>
          <span className="chip">
            Room code <b className="mono">{room.code}</b>
          </span>
        </div>
      </div>
      <div className="rm-actions">
        <div className="seg" role="radiogroup" aria-label="Room view">
          {LAYOUT_OPTIONS.map((option) => (
            <label className="seg-opt" key={option.value}>
              <input
                type="radio"
                name="layout"
                value={option.value}
                checked={layout === option.value}
                onChange={() => onLayout(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
        {isAdmin && (
          <button
            className="btn btn-secondary"
            type="button"
            aria-pressed={room.inviteEnabled}
            disabled={busy}
            onClick={onToggleInvite}
            title={room.inviteEnabled ? "Anyone with the code can join. Click to close." : "Nobody new can join. Click to open."}
          >
            <Icon icon={room.inviteEnabled ? LockOpen : Lock} size={15} />
            {room.inviteEnabled ? "Invites open" : "Invites closed"}
          </button>
        )}
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void copyInvite()}
          title={room.inviteEnabled ? undefined : "Invites are closed, so the link won't work until the host opens them"}
        >
          <Icon icon={Copy} size={15} />
          {copied ? "Link copied" : "Copy invite"}
        </button>
        {!isAdmin && (
          <ConfirmButton className="btn btn-secondary rm-leave" label="Leave room" confirmLabel="Confirm leave" onConfirm={onLeave}>
            Leave room
          </ConfirmButton>
        )}
      </div>
    </header>
  );
}
