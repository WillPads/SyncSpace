const DEFAULT_HTTP_URL = "http://localhost:4000";

export function getServerHttpUrl(): string {
  return process.env.NEXT_PUBLIC_SERVER_URL ?? DEFAULT_HTTP_URL;
}

export function getServerWsUrl(): string {
  return getServerHttpUrl().replace(/^http/, "ws");
}

export async function patchRoomMedia(
  roomId: string,
  body: { cameraOn?: boolean; micOn?: boolean }
): Promise<void> {
  await fetch(`${getServerHttpUrl()}/rooms/${roomId}/media`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}
