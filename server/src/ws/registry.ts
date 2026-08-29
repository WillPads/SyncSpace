import type { WebSocket } from "ws";

interface ClientInfo {
  roomId: string;
  userId: string;
}

const roomSockets = new Map<string, Set<WebSocket>>();
const clientInfo = new WeakMap<WebSocket, ClientInfo>();

export function addClient(roomId: string, userId: string, ws: WebSocket): void {
  let set = roomSockets.get(roomId);
  if (!set) {
    set = new Set();
    roomSockets.set(roomId, set);
  }
  set.add(ws);
  clientInfo.set(ws, { roomId, userId });
}

export function removeClient(ws: WebSocket): void {
  const info = clientInfo.get(ws);
  if (!info) return;
  const set = roomSockets.get(info.roomId);
  set?.delete(ws);
  if (set && set.size === 0) roomSockets.delete(info.roomId);
}

export function connectedRoomIds(): string[] {
  return [...roomSockets.keys()];
}

export function sendToRoom(roomId: string, payload: unknown): void {
  const set = roomSockets.get(roomId);
  if (!set || set.size === 0) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}
