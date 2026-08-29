"use client";

import { ArrowRight, Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { joinRoomRequest } from "@/lib/api-client";
import { getStoredName, storeName } from "@/lib/identity";
import type { Room } from "@/lib/types";

interface JoinRoomModalProps {
  roomId: string;
  roomName?: string;
  memberCount?: number;
  onJoined: (participantId: string, room: Room) => void;
}

export function JoinRoomModal({ roomId, roomName, memberCount, onJoined }: JoinRoomModalProps) {
  const [name, setName] = useState(() => getStoredName());
  const [task, setTask] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const { room, participantId } = await joinRoomRequest(roomId, { name, task });
      storeName(name);
      onJoined(participantId, room);
    } catch {
      setError("Couldn't join this room. Try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md p-7 sm:p-8">
        <div className="mb-6 flex flex-col gap-1">
          <span className="font-mono text-xs tracking-[0.3em] text-primary">{roomId}</span>
          <h1 className="text-xl font-semibold text-foreground">{roomName ?? "Join this room"}</h1>
          {typeof memberCount === "number" && (
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <Users className="h-3.5 w-3.5" />
              {memberCount} {memberCount === 1 ? "person" : "people"} already here
            </p>
          )}
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="join-name">Your name</Label>
            <Input
              id="join-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Jordan"
              maxLength={40}
              required
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="join-task">What are you working on?</Label>
            <Input
              id="join-task"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="e.g. Reading chapter 4"
              maxLength={120}
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" size="lg" isLoading={isSubmitting} className="mt-1 justify-between">
            Join room
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
}
