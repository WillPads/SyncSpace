import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { deriveTimer, liveRemaining } from "@/lib/timer";
import type { Room } from "@/lib/types";

export function RoomCard({
  room,
  receivedAt,
  now,
  isAdmin,
}: {
  room: Room;
  receivedAt: number;
  now: number;
  isAdmin: boolean;
}) {
  const timer = room.session ? deriveTimer(room.session, liveRemaining(room.session, receivedAt, now)) : null;

  return (
    <li className="room-card">
      <div className="room-top">
        <span className="room-kicker">
          Code <span className="room-code">{room.code}</span>{" "}
          <span className="room-invite">· {room.inviteEnabled ? "Invites open" : "Invite only"}</span>
        </span>
        {isAdmin && <span className="chip chip-ok">Your room</span>}
      </div>
      <h3 className="room-name">{room.name}</h3>
      <div className="room-clock-row">
        <span className="room-clock">{timer?.timeStr ?? "--:--"}</span>
        <span className="muted">{timer?.statusLine}</span>
      </div>
      <div className="bar">
        <div style={{ width: `${((timer?.progress ?? 0) * 100).toFixed(2)}%` }} />
      </div>
      <div className="room-foot">
        <span className="meta">
          <Icon icon={Users} size={14} />
          {room.participants.length} in room
        </span>
        <Link className="btn btn-secondary" href={`/room/${room.id}`}>
          Enter
          <Icon icon={ArrowRight} size={14} />
        </Link>
      </div>
    </li>
  );
}
