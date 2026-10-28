"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { friendlyError } from "@/lib/api";
import { localTimeZone, toDateInput, toTimeInput } from "@/lib/dashboardFormat";
import type { Room } from "@/lib/types";

const DURATIONS = [30, 60, 90, 120];
const FOCUSABLE = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)";

/** Default start: the next full hour, in the user's own time zone. */
function defaultStart(): Date {
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);
  return start;
}

/** Host-only dialog: plan a study session in one of the rooms you host. */
export function ScheduleDialog({
  hostedRooms,
  onSchedule,
  onClose,
}: {
  hostedRooms: Room[];
  onSchedule: (roomId: string, startsAt: Date, durationMin: number) => Promise<void>;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // The parent re-renders often; keeping onClose in a ref stops the focus effect below from re-running.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const [initial] = useState(defaultStart);
  const [roomId, setRoomId] = useState(hostedRooms[0]?.id ?? "");
  const [date, setDate] = useState(toDateInput(initial));
  const [time, setTime] = useState(toTimeInput(initial));
  const [duration, setDuration] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Focus moves into the dialog, Tab stays inside it, and focus goes back to the button that opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector<HTMLElement>("select, input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return closeRef.current();
      if (event.key !== "Tab" || !formRef.current) return;
      const items = Array.from(formRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    const startsAt = new Date(`${date}T${time}`); // no zone suffix: read as the user's local time
    if (!date || !time || Number.isNaN(startsAt.getTime())) {
      return setFieldError("Pick a date and a start time.");
    }
    if (startsAt.getTime() <= Date.now()) {
      return setFieldError("Pick a start time in the future.");
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      await onSchedule(roomId, startsAt, duration);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={formRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-title"
        onSubmit={handleSubmit}
        noValidate
      >
        <span className="dialog-title" id="schedule-title">
          Schedule a session
        </span>
        <div className="field">
          <label htmlFor="sched-room">Room</label>
          <select id="sched-room" className="input" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
            {hostedRooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
          <span className="help">Only rooms you host are listed.</span>
        </div>
        <div className="dialog-row">
          <div className="field">
            <label htmlFor="sched-date">Date</label>
            <input
              id="sched-date"
              className={fieldError ? "input is-invalid" : "input"}
              type="date"
              value={date}
              min={toDateInput(new Date())}
              onChange={(event) => setDate(event.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "sched-err" : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="sched-time">Start time</label>
            <input
              id="sched-time"
              className={fieldError ? "input is-invalid" : "input"}
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "sched-err" : undefined}
            />
          </div>
        </div>
        {fieldError && (
          <p className="field-err" id="sched-err" role="alert">
            {fieldError}
          </p>
        )}
        <span className="help">Times are in your time zone ({localTimeZone()}).</span>
        <div className="field">
          <span className="field-label" id="sched-dur-label">
            Length
          </span>
          <div className="seg" role="radiogroup" aria-labelledby="sched-dur-label">
            {DURATIONS.map((minutes) => (
              <label className="seg-opt" key={minutes}>
                <input
                  type="radio"
                  name="sched-duration"
                  checked={duration === minutes}
                  onChange={() => setDuration(minutes)}
                />
                {minutes} min
              </label>
            ))}
          </div>
        </div>
        {error && (
          <p className="form-err" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Scheduling…" : "Schedule session"}
          </button>
        </div>
      </form>
    </div>
  );
}
