"use client";

import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import useSWR from "swr";
import { AppNav } from "@/components/AppNav";
import { CodeJoinForm } from "@/components/CodeJoinForm";
import { NewRoomDialog } from "@/components/dashboard/NewRoomDialog";
import { RoomCard } from "@/components/dashboard/RoomCard";
import { RequireAuth } from "@/components/RequireAuth";
import { Corners } from "@/components/ui/Corners";
import { Icon } from "@/components/ui/Icon";
import { useNow } from "@/hooks/useNow";
import { type ApiError, api } from "@/lib/api";
import type { Room, User } from "@/lib/types";

export default function DashboardPage() {
  return (
    <Suspense>
      <RequireAuth>{(user) => <Dashboard user={user} />}</RequireAuth>
    </Suspense>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

async function fetchRooms(): Promise<{ rooms: Room[]; receivedAt: number }> {
  return { rooms: await api.listRooms(), receivedAt: Date.now() };
}

function Dashboard({ user }: { user: User }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The overview's "Open a room" lands here with ?new=1.
  const [createOpen, setCreateOpen] = useState(searchParams.get("new") === "1");
  const now = useNow(1000);
  const { data, error, mutate } = useSWR<{ rooms: Room[]; receivedAt: number }, ApiError>("rooms", fetchRooms, {
    refreshInterval: 15_000,
  });

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    router.replace("/dashboard");
  }, [router]);

  const rooms = data?.rooms ?? [];
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const stats = [
    { label: "Your rooms", value: rooms.length },
    { label: "Rooms you host", value: rooms.filter((r) => r.adminId === user.id).length },
    {
      label: "Focusing now",
      value: rooms.filter((r) => r.session?.state === "POMODORO_ACTIVE" && r.session.isRunning).length,
    },
  ];

  return (
    <>
      <AppNav user={user} current="dashboard" />
      <div className="dash">
        <div className="dash-head">
          <div>
            <span className="card-kicker">{today}</span>
            <h1>
              {greeting()}, {user.displayName.split(" ")[0]}
            </h1>
          </div>
          <div className="dash-actions">
            <CodeJoinForm id="dash-code" />
            <button className="btn btn-primary blueprint" type="button" onClick={() => setCreateOpen(true)}>
              <Corners />
              <Icon icon={Plus} />
              New room
            </button>
          </div>
        </div>

        <div className="stats">
          {stats.map((stat) => (
            <div className="stat" key={stat.label}>
              <span className="stat-l">{stat.label}</span>
              <span className="stat-v">{data ? stat.value : "–"}</span>
            </div>
          ))}
        </div>

        <div className="section">
          <h3>Your rooms</h3>
          {error ? (
            <div className="empty">
              <p>{error.message}</p>
              <button className="btn btn-secondary" type="button" onClick={() => void mutate()}>
                Try again
              </button>
            </div>
          ) : data && rooms.length === 0 ? (
            <div className="empty">
              <p>You&apos;re not in any rooms yet. Start one, or join with a code someone shared.</p>
              <button className="btn btn-secondary" type="button" onClick={() => setCreateOpen(true)}>
                <Icon icon={Plus} />
                New room
              </button>
            </div>
          ) : (
            <div className="room-grid">
              {rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  receivedAt={data!.receivedAt}
                  now={now}
                  isAdmin={room.adminId === user.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {createOpen && <NewRoomDialog onClose={closeCreate} />}
    </>
  );
}
