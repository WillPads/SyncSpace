import { NextResponse } from "next/server";
import { parseJsonBody, readString } from "@/lib/http";
import { applyTimerAction, type TimerAction } from "@/lib/store";

const VALID_ACTIONS: TimerAction[] = ["start", "pause", "skip"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(request);
  const action = readString(body, "action");
  const participantId = readString(body, "participantId");

  if (!action || !VALID_ACTIONS.includes(action as TimerAction)) {
    return NextResponse.json({ error: "Invalid timer action." }, { status: 400 });
  }
  if (!participantId) {
    return NextResponse.json({ error: "Missing participantId." }, { status: 400 });
  }

  const result = applyTimerAction(id, action as TimerAction, participantId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ room: result.data });
}
