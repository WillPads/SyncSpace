"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ComponentType, useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { AmbientAudioPlayer } from "@/components/room/AmbientAudioPlayer";
import { ChatTile } from "@/components/room/ChatTile";
import { GridLayout, type LayoutProps, RingLayout, type RoomLayout, TimelineLayout } from "@/components/room/layouts";
import { NotesCard } from "@/components/room/NotesCard";
import { QuizPanel } from "@/components/room/QuizPanel";
import { RoomHead } from "@/components/room/RoomHead";
import { TasksCard } from "@/components/room/TasksCard";
import { ScreenMessage } from "@/components/ui/ScreenMessage";
import { useLiveRoom } from "@/hooks/useLiveRoom";
import { useNow } from "@/hooks/useNow";
import { api, errorMessage } from "@/lib/api";
import { derivePeople } from "@/lib/people";
import { loadStored, saveStored } from "@/lib/storage";
import { deriveTimer, liveRemaining } from "@/lib/timer";
import type { Room, SessionAction, User } from "@/lib/types";

const LAYOUTS: Record<RoomLayout, ComponentType<LayoutProps>> = {
  A: RingLayout,
  B: GridLayout,
  C: TimelineLayout,
};

export function RoomScreen({ roomId, user }: { roomId: string; user: User }) {
  const router = useRouter();
  const { room, receivedAt, error, online, connection, quizVersion, applyRoom, subscribe } = useLiveRoom(roomId);
  const now = useNow(250);
  const [layout, setLayout] = useState<RoomLayout>("A");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setLayout(loadStored<RoomLayout>("layout", "A"));
  }, []);

  const session = room?.session ?? null;
  const timer = session ? deriveTimer(session, liveRemaining(session, receivedAt, now)) : null;

  const pageTitle = !room
    ? null
    : timer?.isActive
      ? `${timer.timeStr} · ${timer.phaseLabel} · SyncSpace`
      : `${room.name} · SyncSpace`;

  useEffect(() => {
    if (!pageTitle) return;
    document.title = pageTitle;
    return () => {
      document.title = "SyncSpace";
    };
  }, [pageTitle]);

  async function run(task: () => Promise<Room>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      applyRoom(await task());
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const isMember = !!room?.participants.some((p) => p.userId === user.id);

  // A 403 after the room loaded means we were removed (the server closes our socket).
  if (error && (error.status === 403 || error.status === 404 || (room && !isMember))) {
    return (
      <>
        <AppNav user={user} current="room" />
        <ScreenMessage
          title={error.status === 404 ? "Room not found" : room ? "You're no longer in this room" : "You're not in this room"}
          body={
            error.status === 404
              ? "It may have been deleted, or the link is wrong."
              : "Ask the host for the room code or an invite link, then join from your dashboard."
          }
        >
          <Link className="btn btn-secondary" href="/dashboard">
            Back to dashboard
          </Link>
        </ScreenMessage>
      </>
    );
  }

  if (!room || !session || !timer) {
    return (
      <>
        <AppNav user={user} current="room" />
        {error ? (
          <ScreenMessage loading title="Can't reach SyncSpace" body={`${error.message} Retrying…`} />
        ) : (
          <ScreenMessage loading title="Connecting to room" />
        )}
      </>
    );
  }

  const isAdmin = room.adminId === user.id;
  const me = room.participants.find((p) => p.userId === user.id);
  const people = derivePeople(room.participants, session, online, user.id);
  const Layout = LAYOUTS[layout];

  function changeLayout(next: RoomLayout) {
    setLayout(next);
    saveStored("layout", next);
  }

  const onAction = (action: SessionAction) => void run(() => api.sessionAction(room.id, action));
  const onRemove = (userId: string) => void run(() => api.removeParticipant(room.id, userId));

  async function leave() {
    try {
      await api.removeParticipant(room!.id, user.id);
      router.push("/dashboard");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <>
      <AppNav user={user} current="room" />
      <main className="rm">
        <RoomHead
          room={room}
          isAdmin={isAdmin}
          onlineCount={online.size}
          connection={connection}
          layout={layout}
          busy={busy}
          onLayout={changeLayout}
          onToggleInvite={() => void run(() => api.setInvite(room.id, !room.inviteEnabled))}
          onLeave={() => void leave()}
        />
        {actionError && (
          <p className="form-err" role="alert">
            {actionError}
          </p>
        )}
        <div className="rm-body">
          <div className="rm-main">
            {session.state === "QUIZ_PHASE" ? (
              <QuizPanel
                roomId={room.id}
                session={session}
                isAdmin={isAdmin}
                busy={busy}
                quizVersion={quizVersion}
                onReset={() => onAction("reset")}
              />
            ) : (
              <Layout
                timer={timer}
                session={session}
                people={people}
                isAdmin={isAdmin}
                busy={busy}
                onAction={onAction}
                onRemove={onRemove}
              />
            )}
            {/* Chat is the last tile of the main column, under the timer and people. */}
            <ChatTile roomId={room.id} userId={user.id} isAdmin={isAdmin} subscribe={subscribe} />
          </div>
          <div className="rm-side">
            <TasksCard
              roomId={room.id}
              sharedTask={me?.task ?? ""}
              onSharedTaskChange={(task) =>
                void api.updateTask(room.id, task).then(applyRoom, (err) => setActionError(errorMessage(err)))
              }
            />
            <NotesCard roomId={room.id} quizVersion={quizVersion} />
            <AmbientAudioPlayer />
          </div>
        </div>
      </main>
    </>
  );
}
