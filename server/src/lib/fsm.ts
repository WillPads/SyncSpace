import type { PomodoroSession, SessionState } from "@prisma/client";

/** Floor for focus and break lengths. */
export const MIN_DURATION_SECONDS = 60;
/** Ceiling for focus and break lengths (also keeps values far inside a 32-bit Int). */
export const MAX_DURATION_SECONDS = 4 * 60 * 60;

export type SessionAction = "start" | "pause" | "resume" | "skip" | "endSession" | "reset";

export const SESSION_ACTIONS: readonly SessionAction[] = ["start", "pause", "resume", "skip", "endSession", "reset"];

/** The fields the state machine reads. */
export type SessionSnapshot = Pick<
  PomodoroSession,
  "state" | "isRunning" | "remainingSeconds" | "updatedAt" | "sessionsCompleted" | "focusDurationSec" | "breakDurationSec"
>;

export type SessionPatch = Partial<SessionSnapshot>;

export type FsmResult = { ok: true; patch: SessionPatch } | { ok: false; error: string };

function nextActiveState(state: SessionState): SessionState {
  return state === "POMODORO_ACTIVE" ? "BREAK" : "POMODORO_ACTIVE";
}

function durationFor(state: SessionState, session: SessionSnapshot): number {
  return state === "BREAK" ? session.breakDurationSec : session.focusDurationSec;
}

function isActive(state: SessionState): boolean {
  return state === "POMODORO_ACTIVE" || state === "BREAK";
}

/**
 * Where a running timer is *now*, derived from the stored snapshot and the server clock.
 * Nothing is persisted: the stored `updatedAt` + `remainingSeconds` already determine the
 * present, so readers just compute it. Focus and break alternate when a phase runs out;
 * whole focus+break cycles are skipped arithmetically, so a room left running for days
 * resolves in constant time. Never enters QUIZ_PHASE or IDLE - those are admin actions.
 */
export function resolveSession(session: SessionSnapshot, now: Date): SessionPatch {
  if (!session.isRunning || !isActive(session.state)) return {};

  const elapsed = Math.max(0, (now.getTime() - session.updatedAt.getTime()) / 1000);
  let state = session.state;
  let sessionsCompleted = session.sessionsCompleted;
  let remaining = session.remainingSeconds - elapsed;

  if (remaining <= 0) {
    // The current phase ended `overshoot` seconds ago.
    let overshoot = -remaining;
    if (state === "POMODORO_ACTIVE") sessionsCompleted += 1;

    const next = nextActiveState(state);
    const nextDuration = durationFor(next, session);
    const cycle = nextDuration + durationFor(state, session);
    if (cycle > 0) {
      // Each full cycle contains exactly one focus period.
      const fullCycles = Math.floor(overshoot / cycle);
      sessionsCompleted += fullCycles;
      overshoot -= fullCycles * cycle;
    }

    if (overshoot < nextDuration) {
      state = next;
      remaining = nextDuration - overshoot;
    } else {
      // `next` ran out as well, so we're back in a phase of the original kind.
      if (next === "POMODORO_ACTIVE") sessionsCompleted += 1;
      remaining = cycle - overshoot;
    }
  }

  return { state, remainingSeconds: remaining, updatedAt: now, sessionsCompleted };
}

/** When the current phase ends, if the timer is running. */
export function phaseEndsAt(session: SessionSnapshot): Date | null {
  if (!session.isRunning || !isActive(session.state)) return null;
  return new Date(session.updatedAt.getTime() + session.remainingSeconds * 1000);
}

function validDuration(seconds: number): boolean {
  return Number.isInteger(seconds) && seconds >= MIN_DURATION_SECONDS && seconds <= MAX_DURATION_SECONDS;
}

export function applyAction(
  session: SessionSnapshot,
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
      if (!validDuration(focusDurationSec) || !validDuration(breakDurationSec)) {
        return {
          ok: false,
          error: `Durations must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS} seconds.`,
        };
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
      if (!isActive(resolved.state)) {
        return { ok: false, error: "Only an active focus or break period can be paused." };
      }
      if (!resolved.isRunning) return { ok: false, error: "The session is already paused." };
      return {
        ok: true,
        patch: {
          isRunning: false,
          state: resolved.state,
          remainingSeconds: resolved.remainingSeconds,
          sessionsCompleted: resolved.sessionsCompleted,
          updatedAt: now,
        },
      };
    }

    case "resume": {
      if (!isActive(resolved.state)) {
        return { ok: false, error: "Only a paused focus or break period can be resumed." };
      }
      if (resolved.isRunning) return { ok: false, error: "The session is already running." };
      return { ok: true, patch: { isRunning: true, updatedAt: now } };
    }

    case "skip": {
      if (!isActive(resolved.state)) {
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
      if (!isActive(resolved.state)) {
        return { ok: false, error: "Can only end an active session to move to the quiz phase." };
      }
      return {
        ok: true,
        patch: {
          state: "QUIZ_PHASE",
          isRunning: false,
          remainingSeconds: resolved.remainingSeconds,
          sessionsCompleted: resolved.sessionsCompleted,
          updatedAt: now,
        },
      };
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
