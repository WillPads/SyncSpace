import { X } from "lucide-react";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { PersonView } from "@/lib/people";

export function RemoveButton({ person, busy, onRemove }: { person: PersonView; busy: boolean; onRemove: (userId: string) => void }) {
  return (
    <ConfirmButton
      className="btn btn-ghost rm-remove"
      label={`Remove ${person.name} from the room`}
      confirmLabel="Remove?"
      disabled={busy}
      onConfirm={() => onRemove(person.userId)}
    >
      <Icon icon={X} />
    </ConfirmButton>
  );
}

/** The host can remove anyone except themselves. */
export function canRemove(person: PersonView, isAdmin: boolean): boolean {
  return isAdmin && !person.isHost && !person.isYou;
}

export function PeopleList({
  people,
  isAdmin,
  busy,
  onRemove,
}: {
  people: PersonView[];
  isAdmin: boolean;
  busy: boolean;
  onRemove: (userId: string) => void;
}) {
  return (
    <section className="tile rm-people" aria-labelledby="rm-people-h">
      <header className="rm-card-head">
        <h2 id="rm-people-h">In this room</h2>
        <span className="rm-count">{people.length}</span>
      </header>
      <ul className="rm-plist">
        {people.map((person) => (
          <li className={cn("rm-row", person.away && "rm-away")} key={person.userId}>
            <span className={cn("rm-av", person.isYou && "is-you")}>{person.initials}</span>
            <span className="rm-row-text">
              <b>
                {person.name}
                {person.isHost && <span className="rm-host"> · host</span>}
              </b>
              <span>{person.taskLabel}</span>
            </span>
            <span className={person.tagClass}>{person.status}</span>
            {canRemove(person, isAdmin) && <RemoveButton person={person} busy={busy} onRemove={onRemove} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
