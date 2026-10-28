import { API_BASE, api } from "@/lib/api";

/**
 * Where the room WebSocket lives.
 *
 * In production the frontend (Vercel) can't proxy WebSocket upgrades, so
 * NEXT_PUBLIC_WS_URL points straight at the server, e.g. wss://syncspace-willpads-api.onrender.com.
 * Locally it's unset and the socket goes through the same /backend proxy as REST.
 */
export function getServerWsUrl(): string {
  const direct = process.env.NEXT_PUBLIC_WS_URL;
  if (direct) return direct.replace(/\/+$/, "");
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${API_BASE}`;
}

/**
 * Opens the room socket. The auth cookie belongs to the frontend's domain, so it
 * isn't sent on a direct connection to the server; instead we fetch a 30-second
 * ticket over the (cookie-authenticated) REST proxy and pass it in the URL.
 */
export async function openRoomSocket(roomId: string): Promise<WebSocket> {
  const ticket = await api.wsTicket();
  const params = new URLSearchParams({ roomId, ticket });
  return new WebSocket(`${getServerWsUrl()}/ws?${params.toString()}`);
}

export async function patchRoomMedia(
  roomId: string,
  body: { cameraOn?: boolean; micOn?: boolean }
): Promise<void> {
  await fetch(`${API_BASE}/rooms/${roomId}/media`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}
