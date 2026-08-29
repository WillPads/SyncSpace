"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { createRoomRequest } from "@/lib/api-client";
import { getStoredName, storeName, storeParticipantId } from "@/lib/identity";

export function CreateRoomPanel() {
  const router = useRouter();
  const [name, setName] = useState(() => getStoredName());
  const [roomName, setRoomName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const { room, participantId } = await createRoomRequest({ hostName: name, roomName });
      storeName(name);
      storeParticipantId(room.id, participantId);
      router.push(`/room/${room.id}`);
    } catch {
      setError("Couldn't create a room right now. Try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5 p-6 sm:p-7">
      <div className="flex items-center gap-2 text-primary">
        <Sparkles className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">Start a session</span>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-foreground">Create a new room</h2>
        <p className="mt-1 text-sm text-muted">You&apos;ll be the host — set the pace and everyone else follows.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="host-name">Your name</Label>
          <Input
            id="host-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Alex"
            maxLength={40}
            required
          />
        </div>
        <div>
          <Label htmlFor="room-name">Room name (optional)</Label>
          <Input
            id="room-name"
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder="e.g. Deep Work Squad"
            maxLength={60}
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" size="lg" isLoading={isSubmitting} className="mt-1 justify-between">
          Create room
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
}
