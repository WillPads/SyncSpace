import type { Session } from "@/lib/types";

// The design groups focus rounds in sets of four. The server has no long break, so a
// set is simply four focus/break pairs and the count wraps into the next set.
export const ROUNDS_PER_SET = 4;

export type DotState = "done" | "now" | "todo";

export interface TimerSegment {
  minutes: number;
  focus: boolean;
  now: boolean;
  fill: number;
  label: string;
}

export interface TimerView {
  isActive: boolean;
  isFocus: boolean;
  isRunning: boolean;
  remaining: number;
  progress: number;
  timeStr: string;
  phaseLabel: string;
  /** "Focus · Round 2 of 4" while running, just the phase otherwise. */
  headline: string;
  roundInSet: number;
  roundsDoneInSet: number;
  roundDots: DotState[];
  nextLabel: string;
  statusLine: string;
  segments: TimerSegment[];
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * Seconds left right now. Measured from when this client received the snapshot, not
 * from the server's updatedAt, so a skewed device clock can't shift the countdown.
 * The server broadcasts every second and handles the flip between phases itself.
 */
export function liveRemaining(session: Session, receivedAt: number, now: number): number {
  const active = session.state === "POMODORO_ACTIVE" || session.state === "BREAK";
  if (!active || !session.isRunning) return session.remainingSeconds;
  return Math.max(0, session.remainingSeconds - (now - receivedAt) / 1000);
}

export function deriveTimer(session: Session, remaining: number): TimerView {
  const { state, isRunning, sessionsCompleted, focusDurationSec, breakDurationSec } = session;
  const isFocus = state === "POMODORO_ACTIVE";
  const isActive = isFocus || state === "BREAK";
  const timeStr = formatClock(remaining);

  // Leaving a focus period increments sessionsCompleted, so during a break the count
  // already includes the round that just finished.
  let round = 1;
  let roundsDoneInSet = 0;
  if (isFocus) {
    round = sessionsCompleted + 1;
    roundsDoneInSet = sessionsCompleted % ROUNDS_PER_SET;
  } else if (state === "BREAK") {
    round = Math.max(1, sessionsCompleted);
    roundsDoneInSet = ((round - 1) % ROUNDS_PER_SET) + 1;
  } else if (state === "QUIZ_PHASE") {
    round = sessionsCompleted;
    roundsDoneInSet = sessionsCompleted === 0 ? 0 : ((sessionsCompleted - 1) % ROUNDS_PER_SET) + 1;
  }
  const roundInSet = ((Math.max(1, round) - 1) % ROUNDS_PER_SET) + 1;

  const total = state === "BREAK" ? breakDurationSec : focusDurationSec;
  const progress = isActive ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;

  const roundDots: DotState[] = Array.from({ length: ROUNDS_PER_SET }, (_, i) => {
    const n = i + 1;
    if (n <= roundsDoneInSet) return "done";
    if (isFocus && n === roundInSet) return "now";
    return "todo";
  });

  const phaseLabel = isFocus ? "Focus" : state === "BREAK" ? "Break" : state === "QUIZ_PHASE" ? "Quiz" : "Ready";

  let nextLabel = "Waiting for the host to start";
  if (state === "QUIZ_PHASE") nextLabel = "Session over. Quiz time";
  else if (isActive && !isRunning) nextLabel = "Paused by the host";
  else if (isFocus) nextLabel = `Break in ${timeStr}`;
  else if (state === "BREAK") nextLabel = `Focus resumes in ${timeStr}`;

  const headline = isActive ? `${phaseLabel} · Round ${roundInSet} of ${ROUNDS_PER_SET}` : phaseLabel;

  let statusLine = "Not started";
  if (state === "QUIZ_PHASE") statusLine = "Quiz phase";
  else if (isActive) statusLine = `${isRunning ? phaseLabel : "Paused"} · round ${roundInSet} of ${ROUNDS_PER_SET}`;

  const currentIndex = isActive ? (roundInSet - 1) * 2 + (isFocus ? 0 : 1) : -1;
  const segments: TimerSegment[] = Array.from({ length: ROUNDS_PER_SET * 2 }, (_, i) => {
    const focus = i % 2 === 0;
    const minutes = Math.round((focus ? focusDurationSec : breakDurationSec) / 60);
    return {
      minutes,
      focus,
      now: i === currentIndex,
      fill: i < currentIndex ? 1 : i === currentIndex ? progress : 0,
      label: focus ? `Focus ${i / 2 + 1} · ${minutes}′` : `${minutes}′`,
    };
  });

  return {
    isActive,
    isFocus,
    isRunning,
    remaining,
    progress,
    timeStr,
    phaseLabel,
    headline,
    roundInSet,
    roundsDoneInSet,
    roundDots,
    nextLabel,
    statusLine,
    segments,
  };
}
