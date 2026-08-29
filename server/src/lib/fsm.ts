import type { PomodoroSession, SessionState } from "@prisma/client";

export const MIN_DURATION_SECONDS = 60;

export type SessionAction = "start" | "pause" | "resume" | "skip" | "endSession" | "reset";

export type SessionPatch = Partial<
  Pick<
    PomodoroSession,
    "state" | "isRunning" | "remainingSeconds" | "updatedAt" | "sessionsCompleted" | "focusDurationSec" | "breakDurationSec"
  >
>;

export type FsmResult = { ok: true; patch: SessionPatch } | { ok: false; error: string };

function nextActiveState(state: SessionState): SessionState {
  return state === "POMODORO_ACTIVE" ? "BREAK" : "POMODORO_ACTIVE";
}

function durationFor(state: SessionState, session: PomodoroSession): number {
  return state === "BREAK" ? session.breakDurationSec : session.focusDurationSec;
}

/**
 * Drift-free resolution: replays elapsed time since `updatedAt` against the running
 * timer, cycling POMODORO_ACTIVE <-> BREAK on expiry. Never auto-enters QUIZ_PHASE or
 * IDLE - those are admin-only transitions. Mirrors the approach in the old in-memory
 * store's resolveTimer, now backed by Prisma-persisted state.
 */
export function resolveSession(session: PomodoroSession, now: Date): SessionPatch {
  if (!session.isRunning) return {};
  if (session.state !== "POMODORO_ACTIVE" && session.state !== "BREAK") return {};

  let state: SessionState = session.state;
  let sessionsCompleted = session.sessionsCompleted;
  let remaining = session.remainingSeconds - (now.getTime() - session.updatedAt.getTime()) / 1000;

  let guard = 0;
  while (remaining <= 0 && guard < 1000) {
    if (state === "POMODORO_ACTIVE") sessionsCompleted += 1;
    state = nextActiveState(state);
    remaining += durationFor(state, session);
    guard += 1;
  }

  return { state, remainingSeconds: remaining, updatedAt: now, sessionsCompleted };
}

export function applyAction(
  session: PomodoroSession,
  action: SessionAction,
  now: Date,
  overrides?: { focusDurationSec?: number; breakDurationSec?: number }
): FsmResult {
  const resolved = { ...session, ...resolveSession(session, now) };

  switch (action) {
    case "start": {
      if (resolved.state !== "IDLE") {
        return { ok: false, error: "A session can only be started from Idle." };
      }
      const focusDurationSec = overrides?.focusDurationSec ?? resolved.focusDurationSec;
      const breakDurationSec = overrides?.breakDurationSec ?? resolved.breakDurationSec;
      if (focusDurationSec < MIN_DURATION_SECONDS || breakDurationSec < MIN_DURATION_SECONDS) {
        return { ok: false, error: `Durations must be at least ${MIN_DURATION_SECONDS} seconds.` };
      }
      return {
        ok: true,
        patch: {
          state: "POMODORO_ACTIVE",
          isRunning: true,
          focusDurationSec,
          breakDurationSec,
          remainingSeconds: focusDurationSec,
          sessionsCompleted: 0,
          updatedAt: now,
        },
      };
    }

    case "pause": {
      if (resolved.state !== "POMODORO_ACTIVE" && resolved.state !== "BREAK") {
        return { ok: false, error: "Only an active focus or break period can be paused." };
      }
      if (!resolved.isRunning) return { ok: false, error: "The session is already paused." };
      return {
        ok: true,
        patch: { isRunning: false, remainingSeconds: resolved.remainingSeconds, updatedAt: now },
      };
    }

    case "resume": {
      if (resolved.state !== "POMODORO_ACTIVE" && resolved.state !== "BREAK") {
        return { ok: false, error: "Only a paused focus or break period can be resumed." };
      }
      if (resolved.isRunning) return { ok: false, error: "The session is already running." };
      return { ok: true, patch: { isRunning: true, updatedAt: now } };
    }

    case "skip": {
      if (resolved.state !== "POMODORO_ACTIVE" && resolved.state !== "BREAK") {
        return { ok: false, error: "Can only skip during an active focus or break period." };
      }
      const nextState = nextActiveState(resolved.state);
      const sessionsCompleted =
        resolved.state === "POMODORO_ACTIVE" ? resolved.sessionsCompleted + 1 : resolved.sessionsCompleted;
      return {
        ok: true,
        patch: {
          state: nextState,
          remainingSeconds: durationFor(nextState, resolved),
          sessionsCompleted,
          updatedAt: now,
        },
      };
    }

    case "endSession": {
      if (resolved.state !== "POMODORO_ACTIVE" && resolved.state !== "BREAK") {
        return { ok: false, error: "Can only end an active session to move to the quiz phase." };
      }
      return { ok: true, patch: { state: "QUIZ_PHASE", isRunning: false, updatedAt: now } };
    }

    case "reset": {
      if (resolved.state !== "QUIZ_PHASE" && resolved.state !== "IDLE") {
        return { ok: false, error: "End the current session before resetting." };
      }
      return {
        ok: true,
        patch: {
          state: "IDLE",
          isRunning: false,
          remainingSeconds: resolved.focusDurationSec,
          sessionsCompleted: 0,
          updatedAt: now,
        },
      };
    }
  }
}
