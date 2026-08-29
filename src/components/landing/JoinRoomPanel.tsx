"use client";

import { ArrowRight, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";

export function JoinRoomPanel() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    router.push(`/room/${trimmed}`);
  }

  return (
    <Card className="flex flex-col gap-5 p-6 sm:p-7">
      <div className="flex items-center gap-2 text-primary">
        <KeyRound className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">Have a code?</span>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-foreground">Join an existing room</h2>
        <p className="mt-1 text-sm text-muted">Enter the room code your group shared with you.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="room-code">Room code</Label>
          <Input
            id="room-code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="e.g. FX7K2"
            maxLength={12}
            autoCapitalize="characters"
            className="text-center font-mono text-lg uppercase tracking-[0.3em]"
            required
          />
        </div>
        <Button type="submit" size="lg" variant="secondary" className="mt-1 justify-between">
          Join room
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
}
