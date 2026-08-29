import type { Room } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

interface RoomResponse {
  room: Room;
}

interface JoinResponse extends RoomResponse {
  participantId: string;
}

interface ErrorResponse {
  error: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T | ErrorResponse;
  if (!res.ok) {
    const message = (data as ErrorResponse).error ?? "Something went wrong.";
    throw new ApiError(message, res.status);
  }
  return data as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchRoom(roomId: string, participantId?: string | null): Promise<RoomResponse> {
  const query = participantId ? `?participantId=${encodeURIComponent(participantId)}` : "";
  return request<RoomResponse>(`/api/rooms/${roomId}${query}`);
}

export function createRoomRequest(input: {
  roomName?: string;
  hostName?: string;
  task?: string;
}): Promise<JoinResponse> {
  return postJson<JoinResponse>("/api/rooms", input);
}

export function joinRoomRequest(
  roomId: string,
  input: { name: string; task: string }
): Promise<JoinResponse> {
  return postJson<JoinResponse>(`/api/rooms/${roomId}/join`, input);
}

export function setTimerActionRequest(
  roomId: string,
  action: "start" | "pause" | "skip",
  participantId: string
): Promise<RoomResponse> {
  return postJson<RoomResponse>(`/api/rooms/${roomId}/timer`, { action, participantId });
}

export function updateTaskRequest(
  roomId: string,
  participantId: string,
  task: string
): Promise<RoomResponse> {
  return postJson<RoomResponse>(`/api/rooms/${roomId}/task`, { participantId, task });
}
