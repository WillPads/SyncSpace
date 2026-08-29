import { NextResponse } from "next/server";
import { getResolvedRoom } from "@/lib/store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const participantId = searchParams.get("participantId");

  const result = getResolvedRoom(id, participantId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ room: result.data });
}
