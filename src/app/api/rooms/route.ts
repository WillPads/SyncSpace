import { NextResponse } from "next/server";
import { parseJsonBody, readString } from "@/lib/http";
import { createRoom } from "@/lib/store";

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  const roomName = readString(body, "roomName");
  const hostName = readString(body, "hostName");
  const task = readString(body, "task");

  const { room, participantId } = createRoom({ roomName, hostName, task });
  return NextResponse.json({ room, participantId }, { status: 201 });
}
