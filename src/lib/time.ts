import type { SessionMode, TimerState } from "@/lib/types";

export const FOCUS_DURATION_SECONDS = 25 * 60;
export const BREAK_DURATION_SECONDS = 5 * 60;

export const STALE_AWAY_MS = 12_000;
export const STALE_REMOVE_MS = 2 * 60_000;
export const EMPTY_ROOM_TTL_MS = 30 * 60_000;

export function durationForMode(mode: SessionMode): number {
  return mode === "focus" ? FOCUS_DURATION_SECONDS : BREAK_DURATION_SECONDS;
}

export function nextMode(mode: SessionMode): SessionMode {
  return mode === "focus" ? "break" : "focus";
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatMinutesLabel(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  return `${minutes} min`;
}

export function computeRemainingSeconds(timer: TimerState, now: number): number {
  if (!timer.isRunning) return timer.remainingSeconds;
  const elapsed = (now - timer.updatedAt) / 1000;
  return Math.max(0, timer.remainingSeconds - elapsed);
}
