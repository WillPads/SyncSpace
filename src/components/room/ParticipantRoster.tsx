import { Crown } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { avatarColor, initials } from "@/lib/avatar";
import { cn } from "@/lib/cn";
import type { Participant, ParticipantStatus } from "@/lib/types";

const STATUS_LABEL: Record<ParticipantStatus, string> = {
  focused: "Focused",
  "on-break": "On break",
  idle: "Idle",
  away: "Away",
};

const STATUS_DOT: Record<ParticipantStatus, string> = {
  focused: "bg-primary",
  "on-break": "bg-muted-strong",
  idle: "bg-muted",
  away: "bg-border-strong",
};

export function ParticipantRoster({
  participants,
  currentParticipantId,
}: {
  participants: Participant[];
  currentParticipantId: string | null;
}) {
  const sorted = [...participants].sort((a, b) => {
    if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
    return a.joinedAt - b.joinedAt;
  });

  return (
    <Card className="flex flex-col gap-1 p-5">
      <h2 className="mb-2 px-1 text-sm font-medium text-foreground">Who&apos;s here</h2>
      <ul className="flex flex-col gap-1">
        {sorted.map((participant) => {
          const color = avatarColor(participant.colorIndex);
          const isYou = participant.id === currentParticipantId;
          return (
            <li
              key={participant.id}
              className={cn(
                "flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors",
                isYou && "bg-surface-raised"
              )}
            >
              <div className="relative shrink-0">
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold",
                    color.bg,
                    color.text
                  )}
                >
                  {initials(participant.name)}
                </div>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface",
                    STATUS_DOT[participant.status]
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {participant.name}
                    {isYou && <span className="text-muted"> (you)</span>}
                  </span>
                  {participant.isHost && <Crown className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </div>
                <p className="truncate text-xs text-muted">{participant.task || "—"}</p>
              </div>
              <span className="shrink-0 text-[11px] text-muted">{STATUS_LABEL[participant.status]}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
