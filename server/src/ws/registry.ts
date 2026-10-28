import type { WebSocket } from "ws";
import { CloseCode, type ServerMessage } from "./protocol.js";

export interface ClientInfo {
  roomId: string;
  userId: string;
  sessionId: string;
  /** Cleared on every heartbeat ping and set again by the pong. */
  isAlive: boolean;
  /** Token bucket for inbound messages. */
  tokens: number;
  lastRefill: number;
}

// A client that can't keep up (more than this much unsent data) is cut loose rather than
// letting its backlog grow without bound in server memory.
const MAX_BUFFERED_BYTES = 1024 * 1024;

const roomSockets = new Map<string, Set<WebSocket>>();
const clients = new Map<WebSocket, ClientInfo>();

export function addClient(ws: WebSocket, info: ClientInfo): void {
  let set = roomSockets.get(info.roomId);
  if (!set) {
    set = new Set();
    roomSockets.set(info.roomId, set);
  }
  set.add(ws);
  clients.set(ws, info);
}

export function removeClient(ws: WebSocket): ClientInfo | undefined {
  const info = clients.get(ws);
  if (!info) return undefined;
  clients.delete(ws);
  const set = roomSockets.get(info.roomId);
  set?.delete(ws);
  if (set && set.size === 0) roomSockets.delete(info.roomId);
  return info;
}

export function getClient(ws: WebSocket): ClientInfo | undefined {
  return clients.get(ws);
}

export function allClients(): IterableIterator<[WebSocket, ClientInfo]> {
  return clients.entries();
}

export function connectedRoomIds(): string[] {
  return [...roomSockets.keys()];
}

export function hasClients(roomId: string): boolean {
  return (roomSockets.get(roomId)?.size ?? 0) > 0;
}

function deliver(ws: WebSocket, data: string): boolean {
  if (ws.readyState !== ws.OPEN) return false;
  if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
    ws.terminate();
    return false;
  }
  ws.send(data);
  return true;
}

export function sendToSocket(ws: WebSocket, message: ServerMessage): void {
  deliver(ws, JSON.stringify(message));
}

export function sendToRoom(roomId: string, message: ServerMessage): void {
  const set = roomSockets.get(roomId);
  if (!set || set.size === 0) return;
  const data = JSON.stringify(message);
  for (const ws of set) deliver(ws, data);
}

/** Delivers to every socket a participant has open in the room (e.g. several tabs). Returns how many got it. */
export function sendToUser(roomId: string, userId: string, message: ServerMessage): number {
  const set = roomSockets.get(roomId);
  if (!set || set.size === 0) return 0;
  const data = JSON.stringify(message);
  let delivered = 0;
  for (const ws of set) {
    if (clients.get(ws)?.userId === userId && deliver(ws, data)) delivered += 1;
  }
  return delivered;
}

export function isUserOnline(roomId: string, userId: string): boolean {
  const set = roomSockets.get(roomId);
  if (!set) return false;
  for (const ws of set) {
    if (clients.get(ws)?.userId === userId) return true;
  }
  return false;
}

export function onlineUserIds(roomId: string): string[] {
  const set = roomSockets.get(roomId);
  if (!set) return [];
  const ids = new Set<string>();
  for (const ws of set) {
    const info = clients.get(ws);
    if (info) ids.add(info.userId);
  }
  return [...ids];
}

function closeWhere(predicate: (info: ClientInfo) => boolean, code: number, reason: string): void {
  for (const [ws, info] of clients) {
    if (predicate(info)) ws.close(code, reason);
  }
}

/** Closes a participant's sockets in one room, e.g. once they've left or been removed. */
export function disconnectUser(roomId: string, userId: string): void {
  closeWhere((info) => info.roomId === roomId && info.userId === userId, CloseCode.NotAParticipant, "No longer a participant");
}

/** Closes every socket opened under a session that was just signed out. */
export function disconnectSession(sessionId: string): void {
  closeWhere((info) => info.sessionId === sessionId, CloseCode.SignedOut, "Signed out");
}

/** Closes all of a user's sockets in every room (e.g. "sign out everywhere"). */
export function disconnectUserEverywhere(userId: string): void {
  closeWhere((info) => info.userId === userId, CloseCode.SignedOut, "Signed out");
}

/** Closes all of a user's sockets except those opened under one session (e.g. after a password change). */
export function disconnectUserExceptSession(userId: string, keepSessionId: string): void {
  closeWhere((info) => info.userId === userId && info.sessionId !== keepSessionId, CloseCode.SignedOut, "Signed out");
}

export function closeRoom(roomId: string): void {
  closeWhere((info) => info.roomId === roomId, CloseCode.RoomDeleted, "Room deleted");
}

export function closeAll(code: number, reason: string): void {
  closeWhere(() => true, code, reason);
}
