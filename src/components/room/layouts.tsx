import { Corners } from "@/components/ui/Corners";
import { PeopleList, RemoveButton, canRemove } from "@/components/room/PeopleList";
import { RoundDots, TimerControls, durationsLabel, hostNote } from "@/components/room/TimerControls";
import { cn } from "@/lib/cn";
import type { PersonView } from "@/lib/people";
import { ROUNDS_PER_SET, type TimerView } from "@/lib/timer";
import type { Session, SessionAction } from "@/lib/types";

export type RoomLayout = "A" | "B" | "C";

export const LAYOUT_OPTIONS: { value: RoomLayout; label: string }[] = [
  { value: "A", label: "Ring" },
  { value: "B", label: "Grid" },
  { value: "C", label: "Timeline" },
];

export interface LayoutProps {
  timer: TimerView;
  session: Session;
  people: PersonView[];
  isAdmin: boolean;
  busy: boolean;
  onAction: (action: SessionAction) => void;
  onRemove: (userId: string) => void;
}

// Breaks draw in a lighter green so the phase reads at a glance.
function phaseColor(timer: TimerView): string {
  return timer.isFocus ? "var(--color-accent)" : "var(--color-accent-400)";
}

const R = 124;
const CIRCUMFERENCE = 2 * Math.PI * R;
const TICKS = Array.from({ length: 60 }, (_, k) => {
  const angle = (k / 60) * 2 * Math.PI;
  const inner = k % 5 === 0 ? 134 : 138;
  const outer = 144;
  return {
    x1: (150 + inner * Math.sin(angle)).toFixed(1),
    y1: (150 - inner * Math.cos(angle)).toFixed(1),
    x2: (150 + outer * Math.sin(angle)).toFixed(1),
    y2: (150 - outer * Math.cos(angle)).toFixed(1),
  };
});

export function RingLayout({ timer, session, people, isAdmin, busy, onAction, onRemove }: LayoutProps) {
  return (
    <>
      <div className="ring-card blueprint">
        <Corners />
        <div className="ring">
          <svg viewBox="0 0 300 300" aria-hidden>
            {TICKS.map((tick, i) => (
              <line key={i} className="tick" {...tick} />
            ))}
            <circle className="track" cx="150" cy="150" r={R} />
            <circle
              className="prog"
              cx="150"
              cy="150"
              r={R}
              transform="rotate(-90 150 150)"
              style={{ stroke: phaseColor(timer), strokeDashoffset: (CIRCUMFERENCE * (1 - timer.progress)).toFixed(1) }}
            />
          </svg>
          <div className="ring-center">
            <span className="eyebrow">{timer.phaseLabel}</span>
            <span className="ring-time" role="timer">
              {timer.timeStr}
            </span>
            <span className="muted">
              {timer.isActive ? `Round ${timer.roundInSet} of ${ROUNDS_PER_SET}` : durationsLabel(session)}
            </span>
          </div>
        </div>
        <RoundDots dots={timer.roundDots} />
        {isAdmin && (
          <div className="controls">
            <TimerControls timer={timer} busy={busy} onAction={onAction} variant="full" />
          </div>
        )}
        <span className="host-note">{hostNote(timer, isAdmin)}</span>
      </div>
      <PeopleList people={people} isAdmin={isAdmin} busy={busy} onRemove={onRemove} />
    </>
  );
}

export function GridLayout({ timer, people, isAdmin, busy, onAction }: LayoutProps) {
  return (
    <>
      <div className="strip blueprint">
        <Corners />
        <div className="strip-head">
          <span className="eyebrow">{timer.headline}</span>
          <span className="strip-time" role="timer">
            {timer.timeStr}
          </span>
        </div>
        <div className="strip-prog">
          <div className="bar">
            <div style={{ width: `${(timer.progress * 100).toFixed(2)}%`, background: phaseColor(timer) }} />
          </div>
          <span>{isAdmin ? timer.nextLabel : `${timer.nextLabel} · ${hostNote(timer, false).toLowerCase()}`}</span>
        </div>
        {isAdmin && (
          <div className="strip-btns">
            <TimerControls timer={timer} busy={busy} onAction={onAction} variant="icons" />
          </div>
        )}
      </div>
      <div className="tiles">
        {people.map((person) => (
          <div className={cn("tile blueprint", person.isYou && "is-you", person.away && "is-away")} key={person.userId}>
            <Corners />
            <div className="tile-face">{person.initials}</div>
            <div className="row-between">
              <span className="tile-name ellipsis">{person.name}</span>
              <span className={person.tagClass}>{person.status}</span>
            </div>
            <span className="tile-task">{person.taskLabel}</span>
            <RoundDots dots={timer.roundDots} className="tile-dots" />
          </div>
        ))}
      </div>
    </>
  );
}

export function TimelineLayout({ timer, people, isAdmin, busy, onAction, onRemove }: LayoutProps) {
  return (
    <>
      <div className="tl">
        <div className="tl-top">
          <div>
            <span className="eyebrow">{timer.headline}</span>
            <span
              className="tl-time"
              role="timer"
              style={{ color: timer.isActive && !timer.isFocus ? "var(--color-accent-700)" : "var(--color-text)" }}
            >
              {timer.timeStr}
            </span>
          </div>
          {isAdmin ? (
            <div className="tl-btns">
              <TimerControls timer={timer} busy={busy} onAction={onAction} variant="text" />
            </div>
          ) : (
            <span className="host-note tl-note">{hostNote(timer, false)}</span>
          )}
        </div>
        <div className="segs">
          {timer.segments.map((segment, i) => (
            <div
              key={i}
              className={cn("seg-cell", segment.focus && "is-focus", segment.now && "is-now")}
              style={{ flex: `${segment.minutes} 1 0` }}
            >
              <div className="seg-box">
                <div className="seg-fill" style={{ width: `${(segment.fill * 100).toFixed(2)}%` }} />
              </div>
              <span className="seg-label">{segment.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tl-table">
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Working on</th>
              <th>Rounds</th>
              <th>Status</th>
              {isAdmin && (
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr className={person.away ? "is-away" : undefined} key={person.userId}>
                <td>
                  <span className="who">
                    <span className={cn("av", person.isYou && "is-you")}>{person.initials}</span>
                    {person.name}
                  </span>
                </td>
                <td className="tl-task">{person.taskLabel}</td>
                <td className="tnum">
                  {timer.roundsDoneInSet} / {ROUNDS_PER_SET}
                </td>
                <td>
                  <span className={person.tagClass}>{person.status}</span>
                </td>
                {isAdmin && (
                  <td className="ta-r">
                    {canRemove(person, isAdmin) && <RemoveButton person={person} busy={busy} onRemove={onRemove} />}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
