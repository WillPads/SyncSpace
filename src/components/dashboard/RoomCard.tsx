import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";
import { Corners } from "@/components/ui/Corners";
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
    <div className="card blueprint room-card">
      <Corners />
      <div className="row-between">
        <span className="card-kicker ellipsis">
          Code {room.code} · {room.inviteEnabled ? "Invites open" : "Invite only"}
        </span>
        {isAdmin && <span className="tag tag-accent">Your room</span>}
      </div>
      <span className="card-title">{room.name}</span>
      <div className="room-clock-row">
        <span className="room-clock">{timer?.timeStr ?? "--:--"}</span>
        <span className="muted">{timer?.statusLine}</span>
      </div>
      <div className="bar">
        <div style={{ width: `${((timer?.progress ?? 0) * 100).toFixed(2)}%` }} />
      </div>
      <div className="room-foot">
        <span className="card-meta">
          <Icon icon={Users} size={14} />
          {room.participants.length} in room
        </span>
        <Link className="btn btn-secondary" href={`/room/${room.id}`}>
          Enter
          <Icon icon={ArrowRight} size={14} />
        </Link>
      </div>
    </div>
  );
}
