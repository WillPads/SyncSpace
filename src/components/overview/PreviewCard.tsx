"use client";

import { useEffect, useState } from "react";
import { formatClock } from "@/lib/timer";

const FOCUS_SECONDS = 25 * 60;
const START_AT = 18 * 60 + 42;

/** An illustration of a room mid-round. It runs locally and is labelled as a preview. */
export function PreviewCard() {
  const [remaining, setRemaining] = useState(START_AT);

  useEffect(() => {
    const id = setInterval(() => setRemaining((r) => (r <= 1 ? FOCUS_SECONDS : r - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const clock = formatClock(remaining);
  const progress = `${((1 - remaining / FOCUS_SECONDS) * 100).toFixed(2)}%`;

  return (
    <div className="tile ovw-preview" role="group" aria-label="Preview of a room timer">
      <div className="ovw-preview-head">
        <span className="ovw-kicker">Preview · a room mid-session</span>
        <span className="chip chip-ok">Focus</span>
      </div>
      <div className="ovw-clock">{clock}</div>
      <div className="ovw-progress" aria-hidden="true">
        <div style={{ width: progress }} />
      </div>
      <p className="help ovw-preview-note">Everyone in the room sees this exact clock, to the second.</p>
    </div>
  );
}
