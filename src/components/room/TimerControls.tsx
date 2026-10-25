import { Flag, Pause, Play, SkipForward } from "lucide-react";
import { Corners } from "@/components/ui/Corners";
import { Icon } from "@/components/ui/Icon";
import type { DotState, TimerView } from "@/lib/timer";
import type { Session, SessionAction } from "@/lib/types";

/**
 * Host-only clock controls. `full` is the ring view's labelled buttons, `text` the
 * timeline's (labels, no icons) and `icons` the grid strip's square buttons.
 */
export function TimerControls({
  timer,
  busy,
  onAction,
  variant,
}: {
  timer: TimerView;
  busy: boolean;
  onAction: (action: SessionAction) => void;
  variant: "full" | "text" | "icons";
}) {
  const size = variant === "icons" ? "btn-icon" : "btn-lg";
  const showIcon = variant !== "text";
  const iconSize = variant === "icons" ? 18 : 16;

  const buttons: { action: SessionAction; label: string; icon: typeof Play; primary?: boolean }[] = timer.isActive
    ? [
        { action: timer.isRunning ? "pause" : "resume", label: timer.isRunning ? "Pause for all" : "Resume", icon: timer.isRunning ? Pause : Play, primary: true },
        { action: "skip", label: timer.isFocus ? "Skip to break" : "Skip to focus", icon: SkipForward },
        { action: "endSession", label: "End session", icon: Flag },
      ]
    : [{ action: "start", label: "Start session", icon: Play, primary: true }];

  return (
    <>
      {buttons.map(({ action, label, icon, primary }) => (
        <button
          key={action}
          type="button"
          className={primary ? `btn btn-primary blueprint ${size}` : `btn btn-secondary ${size}`}
          disabled={busy}
          title={variant === "icons" ? label : undefined}
          aria-label={variant === "icons" ? label : undefined}
          onClick={() => onAction(action)}
        >
          {primary && <Corners />}
          {showIcon && <Icon icon={icon} size={iconSize} />}
          {variant !== "icons" && label}
        </button>
      ))}
    </>
  );
}

export function RoundDots({ dots, className = "round-dots" }: { dots: DotState[]; className?: string }) {
  return (
    <div className={className} aria-hidden>
      {dots.map((state, i) => (
        <span key={i} data-state={state} />
      ))}
    </div>
  );
}

export function hostNote(timer: TimerView, isAdmin: boolean): string {
  if (isAdmin) return "Host controls apply to everyone in the room";
  return timer.isActive ? "The host runs the clock for everyone" : "Waiting for the host to start";
}

export function durationsLabel(session: Session): string {
  return `${Math.round(session.focusDurationSec / 60)} min focus · ${Math.round(session.breakDurationSec / 60)} min break`;
}
