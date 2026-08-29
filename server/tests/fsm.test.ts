import type { PomodoroSession, SessionState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { applyAction, resolveSession } from "../src/lib/fsm.js";

function makeSession(overrides: Partial<PomodoroSession> = {}): PomodoroSession {
  return {
    id: "session-1",
    roomId: "room-1",
    state: "IDLE" as SessionState,
    focusDurationSec: 1500,
    breakDurationSec: 300,
    remainingSeconds: 1500,
    isRunning: false,
    updatedAt: new Date(0),
    sessionsCompleted: 0,
    ...overrides,
  };
}

describe("applyAction", () => {
  it("starts a session from Idle", () => {
    const result = applyAction(makeSession(), "start", new Date(1000));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch).toMatchObject({ state: "POMODORO_ACTIVE", isRunning: true, remainingSeconds: 1500 });
    }
  });

  it("rejects starting a session that isn't Idle", () => {
    const result = applyAction(makeSession({ state: "POMODORO_ACTIVE", isRunning: true }), "start", new Date(1000));
    expect(result.ok).toBe(false);
  });

  it("rejects a start with a sub-minute duration", () => {
    const result = applyAction(makeSession(), "start", new Date(1000), { focusDurationSec: 30 });
    expect(result.ok).toBe(false);
  });

  it("pauses a running session", () => {
    const session = makeSession({ state: "POMODORO_ACTIVE", isRunning: true, remainingSeconds: 900 });
    const result = applyAction(session, "pause", new Date(0));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.isRunning).toBe(false);
  });

  it("rejects pausing an already-paused session", () => {
    const session = makeSession({ state: "POMODORO_ACTIVE", isRunning: false });
    const result = applyAction(session, "pause", new Date(0));
    expect(result.ok).toBe(false);
  });

  it("skip from focus to break increments sessionsCompleted", () => {
    const session = makeSession({ state: "POMODORO_ACTIVE", isRunning: true, remainingSeconds: 900 });
    const result = applyAction(session, "skip", new Date(0));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch).toMatchObject({ state: "BREAK", remainingSeconds: 300, sessionsCompleted: 1 });
    }
  });

  it("skip from break to focus does not increment sessionsCompleted", () => {
    const session = makeSession({ state: "BREAK", isRunning: true, remainingSeconds: 100, sessionsCompleted: 2 });
    const result = applyAction(session, "skip", new Date(0));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch).toMatchObject({ state: "POMODORO_ACTIVE", remainingSeconds: 1500, sessionsCompleted: 2 });
    }
  });

  it("moves an active session to the quiz phase", () => {
    const session = makeSession({ state: "BREAK", isRunning: true });
    const result = applyAction(session, "endSession", new Date(0));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch).toMatchObject({ state: "QUIZ_PHASE", isRunning: false });
  });

  it("rejects ending a session from Idle", () => {
    const result = applyAction(makeSession(), "endSession", new Date(0));
    expect(result.ok).toBe(false);
  });

  it("resets from the quiz phase back to Idle", () => {
    const session = makeSession({ state: "QUIZ_PHASE", sessionsCompleted: 4 });
    const result = applyAction(session, "reset", new Date(0));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch).toMatchObject({ state: "IDLE", sessionsCompleted: 0 });
  });

  it("rejects resetting an active session", () => {
    const session = makeSession({ state: "POMODORO_ACTIVE", isRunning: true });
    const result = applyAction(session, "reset", new Date(0));
    expect(result.ok).toBe(false);
  });
});

describe("resolveSession", () => {
  it("returns no patch for a stopped session", () => {
    const session = makeSession({ isRunning: false });
    expect(resolveSession(session, new Date(999999))).toEqual({});
  });

  it("returns no patch for Idle/QuizPhase even if flagged running", () => {
    const session = makeSession({ state: "QUIZ_PHASE", isRunning: true });
    expect(resolveSession(session, new Date(999999))).toEqual({});
  });

  it("cycles focus -> break on expiry and carries over overshoot", () => {
    const session = makeSession({
      state: "POMODORO_ACTIVE",
      isRunning: true,
      remainingSeconds: 10,
      focusDurationSec: 100,
      breakDurationSec: 50,
      updatedAt: new Date(0),
      sessionsCompleted: 0,
    });
    const patch = resolveSession(session, new Date(15_000));
    expect(patch).toMatchObject({ state: "BREAK", remainingSeconds: 45, sessionsCompleted: 1 });
  });
});
