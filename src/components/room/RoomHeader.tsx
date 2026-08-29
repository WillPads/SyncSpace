"use client";

import { Check, Copy, Users } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";
import type { Room } from "@/lib/types";

export function RoomHeader({ room }: { room: Room }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(room.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
      <div className="flex flex-col gap-1">
        <Logo />
        <p className="pl-10 text-sm text-muted">{room.name}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted">
          <Users className="h-3.5 w-3.5" />
          {room.participants.length} {room.participants.length === 1 ? "person" : "people"}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-2 rounded-full border border-border-strong bg-surface px-4 py-1.5 font-mono text-sm tracking-[0.2em] text-foreground transition-colors hover:border-primary/50"
        >
          {room.id}
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5 text-muted" />}
        </button>
      </div>
    </header>
  );
}
