"use client";

import { use } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { RoomScreen } from "@/components/room/RoomScreen";
import { AppBackdrop } from "@/components/ui/Backdrop";

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    // The root wraps RequireAuth too, so the loading and error screens get the redesigned look.
    <div className="redesign app-screen room-screen">
      <AppBackdrop />
      <RequireAuth>{(user) => <RoomScreen roomId={id} user={user} />}</RequireAuth>
    </div>
  );
}
