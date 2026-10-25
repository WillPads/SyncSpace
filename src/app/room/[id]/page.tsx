"use client";

import { use } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { RoomScreen } from "@/components/room/RoomScreen";

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RequireAuth>{(user) => <RoomScreen roomId={id} user={user} />}</RequireAuth>;
}
