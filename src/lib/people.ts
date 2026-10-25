import { initials } from "@/lib/avatar";
import type { Participant, Session } from "@/lib/types";

export interface PersonView {
  userId: string;
  name: string;
  initials: string;
  task: string;
  /** What to show under the name: the task, or a hint when there isn't one. */
  taskLabel: string;
  isYou: boolean;
  isHost: boolean;
  away: boolean;
  status: string;
  tagClass: string;
}

function statusFor(session: Session | null, away: boolean): { status: string; tagClass: string } {
  if (away) return { status: "Away", tagClass: "tag tag-outline" };
  switch (session?.state) {
    case "POMODORO_ACTIVE":
      return session.isRunning
        ? { status: "Focusing", tagClass: "tag tag-accent" }
        : { status: "Paused", tagClass: "tag tag-neutral" };
    case "BREAK":
      return { status: "On break", tagClass: "tag tag-neutral" };
    case "QUIZ_PHASE":
      return { status: "Quiz", tagClass: "tag tag-accent" };
    default:
      return { status: "Ready", tagClass: "tag tag-neutral" };
  }
}

/** Host first, then by join order. Anyone without an open room socket shows as away. */
export function derivePeople(
  participants: Participant[],
  session: Session | null,
  online: ReadonlySet<string>,
  userId: string
): PersonView[] {
  return [...participants]
    .sort((a, b) => (a.role === b.role ? a.joinedAt.localeCompare(b.joinedAt) : a.role === "ADMIN" ? -1 : 1))
    .map((p) => {
      const isYou = p.userId === userId;
      const away = !isYou && !online.has(p.userId);
      return {
        userId: p.userId,
        name: isYou ? "You" : p.displayName,
        initials: initials(p.displayName),
        task: p.task,
        taskLabel: p.task || (isYou ? "Add a task in Your tasks" : "No task set"),
        isYou,
        isHost: p.role === "ADMIN",
        away,
        ...statusFor(session, away),
      };
    });
}
