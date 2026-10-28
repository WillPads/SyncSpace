"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import useSWR from "swr";
import { AppNav } from "@/components/AppNav";
import { CodeJoinForm } from "@/components/CodeJoinForm";
import { NewRoomDialog } from "@/components/dashboard/NewRoomDialog";
import { NotesTile } from "@/components/dashboard/NotesTile";
import { QuickNoteTile } from "@/components/dashboard/QuickNoteTile";
import { RecentFilesTile } from "@/components/dashboard/RecentFilesTile";
import { RoomCard } from "@/components/dashboard/RoomCard";
import { UploadTile } from "@/components/dashboard/UploadTile";
import { UpcomingTile } from "@/components/dashboard/UpcomingTile";
import { RequireAuth } from "@/components/RequireAuth";
import { AppBackdrop } from "@/components/ui/Backdrop";
import { Icon } from "@/components/ui/Icon";
import { useMyDocuments } from "@/hooks/useMyDocuments";
import { useNow } from "@/hooks/useNow";
import { type ApiError, api } from "@/lib/api";
import type { Room, User } from "@/lib/types";

export default function DashboardPage() {
  return (
    <Suspense>
      {/* The root wraps RequireAuth too, so the loading and error screens get the redesigned look. */}
      <div className="redesign app-screen">
        <AppBackdrop />
        <RequireAuth>{(user) => <Dashboard user={user} />}</RequireAuth>
      </div>
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

  // Called here (not inside a tile) because Upload and Recent files share the same list.
  const documents = useMyDocuments();

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
      <main className="dash">
        <header className="dash-head">
          <p className="dash-date">{today}</p>
          <h1>
            {greeting()}, {user.displayName.split(" ")[0]}
          </h1>
          <p className="dash-sub">Start a room, or jump back into one you know.</p>
        </header>

        <section className="tile tile-tint dash-create" aria-labelledby="dash-create-h">
          <h2 id="dash-create-h">Create a room</h2>
          <p>Choose a focus and break length, then share the room code with your group.</p>
          <button className="btn btn-primary btn-lg" type="button" onClick={() => setCreateOpen(true)}>
            <Icon icon={Plus} />
            New room
          </button>
        </section>

        <section className="tile dash-join" aria-labelledby="dash-join-h">
          <h2 id="dash-join-h">Join a room</h2>
          <CodeJoinForm
            id="dash-code"
            label="Room code or invite link"
            placeholder="Room code or invite link"
            submitLabel="Join room"
            visibleLabel
          />
        </section>

        <dl className="dash-stats" aria-label="Your numbers">
          {stats.map((stat) => (
            <div className="tile dash-stat" key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{data ? stat.value : "–"}</dd>
            </div>
          ))}
        </dl>

        <UploadTile rooms={rooms} roomsLoading={!data && !error} documents={documents} />
        <NotesTile />
        <QuickNoteTile />

        <RecentFilesTile documents={documents} />
        <UpcomingTile rooms={rooms} userId={user.id} />

        <section className="tile dash-rooms" aria-labelledby="dash-rooms-h">
          <h2 id="dash-rooms-h">Your rooms</h2>
          {error ? (
            <div className="empty" role="alert">
              <p>{error.message}</p>
              <button className="btn btn-secondary" type="button" onClick={() => void mutate()}>
                Try again
              </button>
            </div>
          ) : !data ? (
            <p className="rooms-loading" role="status">
              <Icon icon={LoaderCircle} size={18} className="spin" />
              Loading your rooms…
            </p>
          ) : rooms.length === 0 ? (
            <div className="empty">
              <p>You&apos;re not in any rooms yet. Start one, or join with a code someone shared.</p>
              <button className="btn btn-secondary" type="button" onClick={() => setCreateOpen(true)}>
                <Icon icon={Plus} />
                New room
              </button>
            </div>
          ) : (
            <ul className="room-grid">
              {rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  receivedAt={data.receivedAt}
                  now={now}
                  isAdmin={room.adminId === user.id}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
      {createOpen && <NewRoomDialog onClose={closeCreate} />}
    </>
  );
}
