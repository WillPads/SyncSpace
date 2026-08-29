"use client";

import { Pause, Play, SkipForward } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/cn";
import { computeRemainingSeconds, formatClock } from "@/lib/time";
import type { Room } from "@/lib/types";

interface TimerPanelProps {
  room: Room;
  isHost: boolean;
  onStart: () => Promise<void>;
  onPause: () => Promise<void>;
  onSkip: () => Promise<void>;
}

const RADIUS = 130;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function TimerPanel({ room, isHost, onStart, onPause, onSkip }: TimerPanelProps) {
  const now = useNow(250);
  const [isBusy, setIsBusy] = useState(false);
  const { timer } = room;
  const remaining = computeRemainingSeconds(timer, now);
  const remainingFraction = Math.min(1, Math.max(0, remaining / timer.durationSeconds));
  const isFocus = timer.mode === "focus";

  async function handleAction(action: () => Promise<void>) {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await action();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Card className="flex flex-col items-center gap-8 p-8 sm:p-12">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
        <span className={cn("h-1.5 w-1.5 rounded-full", isFocus ? "bg-primary" : "bg-muted-strong")} />
        {isFocus ? "Focus session" : "Break"}
        <span className="text-border-strong">•</span>
        Session {timer.sessionsCompleted + 1}
      </div>

      <div className="relative flex h-72 w-72 items-center justify-center sm:h-80 sm:w-80">
        <svg viewBox="0 0 280 280" className="absolute inset-0 -rotate-90">
          <circle cx="140" cy="140" r={RADIUS} fill="none" strokeWidth="10" className="stroke-border" />
          <circle
            cx="140"
            cy="140"
            r={RADIUS}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * remainingFraction}
            className={cn(
              "transition-[stroke-dashoffset] duration-500 ease-linear",
              isFocus ? "stroke-primary" : "stroke-muted-strong"
            )}
          />
        </svg>
        <div className="flex flex-col items-center">
          <span className="font-mono text-6xl font-semibold tabular-nums text-foreground sm:text-7xl">
            {formatClock(remaining)}
          </span>
          <span className="mt-2 text-sm text-muted">{timer.isRunning ? "Running" : "Paused"}</span>
        </div>
      </div>

      {isHost ? (
        <div className="flex items-center gap-3">
          {timer.isRunning ? (
            <Button size="lg" variant="secondary" onClick={() => handleAction(onPause)} isLoading={isBusy}>
              <Pause className="h-4 w-4" /> Pause
            </Button>
          ) : (
            <Button size="lg" onClick={() => handleAction(onStart)} isLoading={isBusy}>
              <Play className="h-4 w-4" /> Start
            </Button>
          )}
          <Button size="lg" variant="ghost" onClick={() => handleAction(onSkip)} disabled={isBusy}>
            <SkipForward className="h-4 w-4" /> Skip
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {timer.isRunning ? "The host has started this session." : "Waiting for the host to start…"}
        </p>
      )}
    </Card>
  );
}
