"use client";

import { useEffect, useState } from "react";
import { Corners } from "@/components/ui/Corners";
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
    <div className="live-card blueprint" aria-label="Preview of a room timer">
      <Corners />
      <div className="row-between">
        <span className="card-kicker">Preview · a room mid-session</span>
        <span className="tag tag-accent">Focus</span>
      </div>
      <div className="live-clock">{clock}</div>
      <div className="bar">
        <div style={{ width: progress }} />
      </div>
      <div className="live-meta">
        <span>Focus · Round 2 of 4</span>
        <span>Break in {clock}</span>
      </div>
      <p className="muted preview-note">Everyone in the room sees this exact clock, to the second.</p>
    </div>
  );
}
