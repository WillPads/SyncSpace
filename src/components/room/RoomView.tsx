"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmbientAudioPlayer } from "@/components/room/AmbientAudioPlayer";
import { CurrentTaskCard } from "@/components/room/CurrentTaskCard";
import { JoinRoomModal } from "@/components/room/JoinRoomModal";
import { ParticipantRoster } from "@/components/room/ParticipantRoster";
import { RoomHeader } from "@/components/room/RoomHeader";
import { TimerPanel } from "@/components/room/TimerPanel";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useRoom } from "@/hooks/useRoom";
import { getStoredParticipantId, storeParticipantId } from "@/lib/identity";
import type { Room } from "@/lib/types";

export function RoomView({ roomId }: { roomId: string }) {
  const normalizedId = roomId.trim().toUpperCase();
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setParticipantId(getStoredParticipantId(normalizedId));
    setHydrated(true);
  }, [normalizedId]);

  const { room, isLoading, notFound, start, pause, skip, updateTask, refresh } = useRoom(
    normalizedId,
    participantId
  );

  const currentParticipant = useMemo(
    () => room?.participants.find((p) => p.id === participantId) ?? null,
    [room, participantId]
  );

  function handleJoined(newParticipantId: string, joinedRoom: Room) {
    storeParticipantId(normalizedId, newParticipantId);
    setParticipantId(newParticipantId);
    void refresh(joinedRoom, { revalidate: false });
  }

  if (notFound) {
    return <RoomNotFound roomId={normalizedId} />;
  }

  if (!hydrated || (isLoading && !room)) {
    return <RoomLoading />;
  }

  if (!participantId || (room && !currentParticipant)) {
    return (
      <JoinRoomModal
        roomId={normalizedId}
        roomName={room?.name}
        memberCount={room?.participants.length}
        onJoined={handleJoined}
      />
    );
  }

  if (!room || !currentParticipant) {
    return <RoomLoading />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <RoomHeader room={room} />
      <div className="grid flex-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <TimerPanel room={room} isHost={currentParticipant.isHost} onStart={start} onPause={pause} onSkip={skip} />
          <CurrentTaskCard task={currentParticipant.task} onSave={updateTask} />
        </div>
        <div className="flex flex-col gap-6">
          <ParticipantRoster participants={room.participants} currentParticipantId={participantId} />
          <AmbientAudioPlayer />
        </div>
      </div>
    </div>
  );
}

function RoomLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm">Connecting to room…</p>
    </div>
  );
}

function RoomNotFound({ roomId }: { roomId: string }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="flex max-w-sm flex-col items-center gap-4 p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Room not found</h1>
          <p className="mt-1 text-sm text-muted">
            We couldn&apos;t find a room with the code <span className="font-mono text-foreground">{roomId}</span>.
          </p>
        </div>
        <Button className="w-full" onClick={() => router.push("/")}>
          Back to home
        </Button>
      </Card>
    </div>
  );
}
