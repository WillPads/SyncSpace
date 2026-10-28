"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppBackdrop } from "@/components/ui/Backdrop";
import { ScreenMessage } from "@/components/ui/ScreenMessage";
import { api, errorMessage } from "@/lib/api";
import type { Room } from "@/lib/types";

/** Where invite links and the "Room code" forms land: joins, then opens the room. */
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return (
    // Same page shell as the other redesigned screens, so the loading, error and joining cards match.
    <div className="redesign app-screen room-screen">
      <AppBackdrop />
      <RequireAuth>{() => <JoinRoom code={code.toUpperCase()} />}</RequireAuth>
    </div>
  );
}

function JoinRoom({ code }: { code: string }) {
  const router = useRouter();
  const pending = useRef<{ code: string; promise: Promise<Room> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Development strict mode runs effects twice; both runs share one request.
    if (pending.current?.code !== code) pending.current = { code, promise: api.joinRoom(code) };
    let cancelled = false;
    pending.current.promise.then(
      (room) => {
        if (!cancelled) router.replace(`/room/${room.id}`);
      },
      (err) => {
        if (!cancelled) setError(errorMessage(err));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [code, router]);

  if (error) {
    return (
      <ScreenMessage title={`Couldn't join ${code}`} body={error}>
        <Link className="btn btn-secondary" href="/dashboard">
          Back to dashboard
        </Link>
      </ScreenMessage>
    );
  }
  return <ScreenMessage loading title={`Joining ${code}`} />;
}
