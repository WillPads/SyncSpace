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

// Focus draws in green and breaks in amber (as in the mockup), so the phase reads at a glance.
function phaseColor(timer: TimerView): string {
  return timer.isFocus ? "var(--color-accent)" : "var(--color-amber)";
}

// The ring is drawn in a 224 x 224 box, like the mockup.
const R = 104;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function RingLayout({ timer, session, people, isAdmin, busy, onAction, onRemove }: LayoutProps) {
  return (
    <div className="rm-ring-row">
      <section className="tile rm-timer" aria-label="Pomodoro timer">
        <div className="rm-ring">
          <svg viewBox="0 0 224 224" aria-hidden>
            <circle className="rm-ring-track" cx="112" cy="112" r={R} />
            <circle
              className="rm-ring-prog"
              cx="112"
              cy="112"
              r={R}
              transform="rotate(-90 112 112)"
              style={{
                stroke: phaseColor(timer),
                strokeDasharray: CIRCUMFERENCE.toFixed(1),
                strokeDashoffset: (CIRCUMFERENCE * (1 - timer.progress)).toFixed(1),
              }}
            />
          </svg>
          <div className="rm-ring-center">
            <span className="rm-phase">{timer.phaseLabel}</span>
            <span className="rm-clock" role="timer">
              {timer.timeStr}
            </span>
          </div>
        </div>
        <span className="rm-sub">
          {timer.isActive ? `Round ${timer.roundInSet} of ${ROUNDS_PER_SET}` : durationsLabel(session)}
        </span>
        <RoundDots dots={timer.roundDots} />
        {isAdmin && (
          <div className="rm-controls">
            <TimerControls timer={timer} busy={busy} onAction={onAction} variant="full" />
          </div>
        )}
        <span className="rm-note">{hostNote(timer, isAdmin)}</span>
      </section>
      <PeopleList people={people} isAdmin={isAdmin} busy={busy} onRemove={onRemove} />
    </div>
  );
}

export function GridLayout({ timer, people, isAdmin, busy, onAction }: LayoutProps) {
  return (
    <>
      <section className="tile rm-strip" aria-label="Pomodoro timer">
        <div className="rm-strip-head">
          <span className="rm-phase">{timer.headline}</span>
          <span className="rm-strip-time" role="timer">
            {timer.timeStr}
          </span>
        </div>
        <div className="rm-strip-prog">
          <div className="rm-meter">
            <div style={{ width: `${(timer.progress * 100).toFixed(2)}%`, background: phaseColor(timer) }} />
          </div>
          <span>{isAdmin ? timer.nextLabel : `${timer.nextLabel} · ${hostNote(timer, false).toLowerCase()}`}</span>
        </div>
        {isAdmin && (
          <div className="rm-strip-btns">
            <TimerControls timer={timer} busy={busy} onAction={onAction} variant="icons" />
          </div>
        )}
      </section>
      <ul className="rm-ptiles" aria-label="People in this room">
        {people.map((person) => (
          <li className={cn("tile rm-ptile", person.isYou && "is-you", person.away && "rm-away")} key={person.userId}>
            <div className="rm-ptile-face">
              <span className={cn("rm-av rm-av-lg", person.isYou && "is-you")}>{person.initials}</span>
            </div>
            <div className="rm-ptile-line">
              <span className="rm-name ellipsis">{person.name}</span>
              <span className={person.tagClass}>{person.status}</span>
            </div>
            <span className="rm-task-line">{person.taskLabel}</span>
            <RoundDots dots={timer.roundDots} className="rm-pips rm-pips-sm" />
          </li>
        ))}
      </ul>
    </>
  );
}

export function TimelineLayout({ timer, people, isAdmin, busy, onAction, onRemove }: LayoutProps) {
  return (
    <>
      <section className="tile rm-tl" aria-label="Pomodoro timer">
        <div className="rm-tl-top">
          <div className="rm-tl-clock">
            <span className="rm-phase">{timer.headline}</span>
            <span className={cn("rm-tl-time", timer.isActive && !timer.isFocus && "is-break")} role="timer">
              {timer.timeStr}
            </span>
          </div>
          {isAdmin ? (
            <div className="rm-controls rm-tl-btns">
              <TimerControls timer={timer} busy={busy} onAction={onAction} variant="text" />
            </div>
          ) : (
            <span className="rm-note">{hostNote(timer, false)}</span>
          )}
        </div>
        <div className="rm-segs">
          {timer.segments.map((segment, i) => (
            <div
              key={i}
              className={cn("rm-seg", segment.focus && "is-focus", segment.now && "is-now")}
              style={{ flex: `${segment.minutes} 1 0` }}
            >
              <div className="rm-seg-box">
                <div className="rm-seg-fill" style={{ width: `${(segment.fill * 100).toFixed(2)}%` }} />
              </div>
              <span className="rm-seg-label">{segment.label}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="tile rm-tl-table">
        <table className="rm-table">
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
              <tr className={person.away ? "rm-away" : undefined} key={person.userId}>
                <td>
                  <span className="rm-who">
                    <span className={cn("rm-av", person.isYou && "is-you")}>{person.initials}</span>
                    {person.name}
                  </span>
                </td>
                <td className="rm-td-task">{person.taskLabel}</td>
                <td className="tnum" data-label="Rounds">
                  {timer.roundsDoneInSet} / {ROUNDS_PER_SET}
                </td>
                <td>
                  <span className={person.tagClass}>{person.status}</span>
                </td>
                {isAdmin && (
                  <td className="rm-td-act">
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
