import { NextResponse } from "next/server";
import { parseJsonBody, readString } from "@/lib/http";
import { updateParticipantTask } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(request);
  const participantId = readString(body, "participantId");
  const task = readString(body, "task") ?? "";

  if (!participantId) {
    return NextResponse.json({ error: "Missing participantId." }, { status: 400 });
  }

  const result = updateParticipantTask(id, participantId, task);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ room: result.data });
}
