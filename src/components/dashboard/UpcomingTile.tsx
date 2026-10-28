"use client";

import { ArrowRight, CalendarPlus, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ScheduleDialog } from "@/components/dashboard/ScheduleDialog";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Icon } from "@/components/ui/Icon";
import { useNow } from "@/hooks/useNow";
import { useUpcoming } from "@/hooks/useUpcoming";
import { type UpcomingSession, friendlyError } from "@/lib/api";
import { durationLabel, sessionEndsAt, sessionWhen } from "@/lib/dashboardFormat";
import type { Room } from "@/lib/types";

/** "Upcoming sessions": planned study sessions across your rooms. Hosts can add and remove them. */
export function UpcomingTile({ rooms, userId }: { rooms: Room[]; userId: string }) {
  const { sessions, error, isLoading, schedule, remove, retry } = useUpcoming();
  const now = useNow(30_000);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Only a room's host (admin) can add or delete its sessions; everyone else just sees them.
  const hostedIds = new Set(rooms.filter((room) => room.adminId === userId).map((room) => room.id));
  const hostedRooms = rooms.filter((room) => hostedIds.has(room.id));
  // A session stays listed while it is running; drop the ones that ended since the last fetch.
  const upcoming = sessions?.filter((s) => sessionEndsAt(s.startsAt, s.durationMin) > now);

  async function handleDelete(session: UpcomingSession) {
    setMessage(null);
    try {
      await remove(session);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }

  return (
    <section className="tile dash-upcoming" aria-labelledby="upcoming-h">
      <div className="tile-head">
        <h2 id="upcoming-h">Upcoming sessions</h2>
        {hostedRooms.length > 0 && (
          <button className="btn btn-secondary" type="button" onClick={() => setDialogOpen(true)}>
            <Icon icon={CalendarPlus} />
            Schedule
          </button>
        )}
      </div>
      {message && (
        <p className="form-err" role="alert">
          {message}
        </p>
      )}
      {error && !sessions ? (
        <div className="empty" role="alert">
          <p>{friendlyError(error)}</p>
          <button className="btn btn-secondary" type="button" onClick={() => void retry()}>
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <p className="rooms-loading" role="status">
          <Icon icon={LoaderCircle} size={18} className="spin" />
          Loading sessions…
        </p>
      ) : upcoming && upcoming.length === 0 ? (
        <div className="empty">
          <p>
            Nothing planned yet.{" "}
            {hostedRooms.length > 0
              ? "Schedule a session so your room knows when to show up."
              : "When a host schedules a session for one of your rooms, it will show up here."}
          </p>
        </div>
      ) : (
        <ul className="rows">
          {upcoming?.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              now={now}
              canDelete={hostedIds.has(session.roomId)}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      )}
      {dialogOpen && (
        <ScheduleDialog hostedRooms={hostedRooms} onSchedule={schedule} onClose={() => setDialogOpen(false)} />
      )}
    </section>
  );
}

function SessionRow({
  session,
  now,
  canDelete,
  onDelete,
}: {
  session: UpcomingSession;
  now: number;
  canDelete: boolean;
  onDelete: (session: UpcomingSession) => void;
}) {
  const start = new Date(session.startsAt);
  const inProgress = start.getTime() <= now;

  return (
    <li className="row">
      <time className="datebox" dateTime={session.startsAt}>
        <span className="datebox-m">{start.toLocaleDateString(undefined, { month: "short" })}</span>
        <span className="datebox-n">{start.getDate()}</span>
      </time>
      <div className="row-info">
        <span className="row-title">{session.roomName}</span>
        <span className="row-sub">
          {sessionWhen(session.startsAt, session.durationMin, now)} · {durationLabel(session.durationMin)}
        </span>
      </div>
      <div className="row-actions">
        {inProgress && <span className="chip chip-ok">In progress</span>}
        <Link className="btn btn-secondary" href={`/room/${session.roomId}`}>
          {inProgress ? "Join" : "Open room"}
          <Icon icon={ArrowRight} size={14} />
        </Link>
        {canDelete && (
          <ConfirmButton
            className="btn btn-secondary"
            confirmLabel="Confirm remove"
            label={`Remove the ${session.roomName} session`}
            onConfirm={() => onDelete(session)}
          >
            Remove
          </ConfirmButton>
        )}
      </div>
    </li>
  );
}
