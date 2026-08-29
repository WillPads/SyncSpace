import { NextResponse } from "next/server";
import { parseJsonBody, readString } from "@/lib/http";
import { joinRoom } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(request);
  const name = readString(body, "name") ?? "";
  const task = readString(body, "task") ?? "";

  const result = joinRoom(id, name, task);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    { room: result.data.room, participantId: result.data.participantId },
    { status: 201 }
  );
}
