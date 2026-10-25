import { parse as parseCookie } from "cookie";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { getConfig } from "../config.js";
import { prisma } from "../db.js";
import { SESSION_COOKIE_NAME, redeemWsTicket, validateSession } from "../lib/auth.js";
import { isUuid } from "../lib/http.js";
import { PROTOCOL_VERSION, clientMessageSchema, type ServerMessage } from "./protocol.js";
import {
  addClient,
  allClients,
  closeAll,
  getClient,
  isUserOnline,
  onlineUserIds,
  removeClient,
  sendToRoom,
  sendToSocket,
  sendToUser,
} from "./registry.js";
import { publishRoom, publishRoomInBackground, pulseRooms } from "./roomFeed.js";

export { publishRoom } from "./roomFeed.js";

/** Largest frame a client may send. SDP offers are a few KB; this leaves ample room. */
export const MAX_MESSAGE_BYTES = 64 * 1024;
const HEARTBEAT_INTERVAL_MS = 30_000;
// Inbound message budget per socket: bursts of up to 200 (ICE candidates for a full room
// arrive in a rush), refilled at 50 per second.
const MESSAGE_BURST = 200;
const MESSAGES_PER_SECOND = 50;
// How long someone must stay disconnected before their camera/mic flags are cleared, so a
// page refresh (old socket closes, new one opens) doesn't wipe a setting made right after.
const MEDIA_RESET_GRACE_MS = 5_000;

export interface RealtimeOptions {
  /** Sync pulse interval. Defaults to WS_TICK_MS (1000 ms). */
  tickMs?: number;
  heartbeatMs?: number;
  /** Browser origins allowed to authenticate with the session cookie. Defaults to CLIENT_ORIGIN. */
  allowedOrigins?: string[];
  mediaResetGraceMs?: number;
}

let mediaResetGraceMs = MEDIA_RESET_GRACE_MS;
const pendingMediaResets = new Map<string, NodeJS.Timeout>();

export interface RealtimeServer {
  wss: WebSocketServer;
  /** Stops the loops and closes every socket (used on shutdown). */
  close(code?: number, reason?: string): void;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (!socket.destroyed) {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }
}

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  // Non-browser clients (native apps, CLIs) don't send Origin; browsers always do.
  if (!origin) return true;
  return allowed.includes(origin.replace(/\/+$/, ""));
}

async function authenticateUpgrade(
  req: IncomingMessage,
  url: URL,
  allowedOrigins: string[]
): Promise<{ userId: string; sessionId: string } | "forbidden-origin" | null> {
  const ticket = url.searchParams.get("ticket");
  if (ticket) return redeemWsTicket(ticket);

  // Same-origin fallback: the session cookie. A cookie rides along on cross-site requests
  // too, so only accept it from our own origins (blocks cross-site WebSocket hijacking).
  const token = parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE_NAME];
  if (!token) return null;
  if (!originAllowed(req.headers.origin, allowedOrigins)) return "forbidden-origin";
  const validated = await validateSession(token);
  return validated ? { userId: validated.user.id, sessionId: validated.session.id } : null;
}

function takeToken(ws: WebSocket): boolean {
  const info = getClient(ws);
  if (!info) return false;
  const now = Date.now();
  info.tokens = Math.min(MESSAGE_BURST, info.tokens + ((now - info.lastRefill) / 1000) * MESSAGES_PER_SECOND);
  info.lastRefill = now;
  if (info.tokens < 1) return false;
  info.tokens -= 1;
  return true;
}

function sendError(ws: WebSocket, code: string, message: string): void {
  sendToSocket(ws, { type: "error", code, message });
}

function handleClientMessage(ws: WebSocket, raw: RawData, isBinary: boolean): void {
  const info = getClient(ws);
  if (!info) return;
  info.isAlive = true;

  if (!takeToken(ws)) {
    ws.close(1008, "Too many messages");
    return;
  }
  if (isBinary) {
    sendError(ws, "INVALID_MESSAGE", "Messages must be JSON text.");
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw.toString());
  } catch {
    sendError(ws, "INVALID_MESSAGE", "Messages must be valid JSON.");
    return;
  }
  const parsed = clientMessageSchema.safeParse(json);
  if (!parsed.success) {
    sendError(ws, "INVALID_MESSAGE", "Unknown or malformed message.");
    return;
  }

  const message = parsed.data;
  switch (message.type) {
    case "time:ping":
      sendToSocket(ws, { type: "time:pong", clientTime: message.clientTime, serverTime: Date.now() });
      return;
    case "webrtc:offer":
    case "webrtc:answer":
    case "webrtc:ice-candidate": {
      if (message.to === info.userId) {
        sendError(ws, "INVALID_MESSAGE", "Can't signal yourself.");
        return;
      }
      // Relayed opaque - the server never inspects SDP/ICE contents, it only routes them
      // to the target's sockets in the same room.
      const outbound: ServerMessage = { type: message.type, from: info.userId, payload: message.payload };
      if (sendToUser(info.roomId, message.to, outbound) === 0) {
        sendToSocket(ws, { type: "webrtc:peer-unavailable", userId: message.to });
      }
      return;
    }
  }
}

async function clearMediaFlags(roomId: string, userId: string): Promise<void> {
  // Nobody has a camera or mic on in a room they're no longer connected to.
  const { count } = await prisma.participant.updateMany({
    where: { roomId, userId, OR: [{ cameraOn: true }, { micOn: true }] },
    data: { cameraOn: false, micOn: false },
  });
  if (count > 0) await publishRoom(roomId);
}

function cancelMediaReset(roomId: string, userId: string): void {
  const key = `${roomId}:${userId}`;
  clearTimeout(pendingMediaResets.get(key));
  pendingMediaResets.delete(key);
}

function scheduleMediaReset(roomId: string, userId: string): void {
  cancelMediaReset(roomId, userId);
  const key = `${roomId}:${userId}`;
  const timer = setTimeout(() => {
    pendingMediaResets.delete(key);
    if (isUserOnline(roomId, userId)) return;
    clearMediaFlags(roomId, userId).catch((err: unknown) =>
      console.error(`Failed to clear media flags for ${userId}:`, err)
    );
  }, mediaResetGraceMs);
  timer.unref();
  pendingMediaResets.set(key, timer);
}

function handleClose(ws: WebSocket): void {
  const info = removeClient(ws);
  if (!info) return;
  // Still online in another tab? Then they haven't left.
  if (isUserOnline(info.roomId, info.userId)) return;
  sendToRoom(info.roomId, { type: "presence:left", userId: info.userId });
  scheduleMediaReset(info.roomId, info.userId);
}

function onConnection(
  ws: WebSocket,
  auth: { roomId: string; userId: string; sessionId: string },
  heartbeatMs: number
): void {
  const firstConnection = !isUserOnline(auth.roomId, auth.userId);
  cancelMediaReset(auth.roomId, auth.userId);
  addClient(ws, { ...auth, isAlive: true, tokens: MESSAGE_BURST, lastRefill: Date.now() });

  ws.on("pong", () => {
    const info = getClient(ws);
    if (info) info.isAlive = true;
  });
  ws.on("message", (raw, isBinary) => handleClientMessage(ws, raw, isBinary));
  ws.on("close", () => handleClose(ws));
  // 'close' always follows 'error', and does the cleanup.
  ws.on("error", (err) => console.warn(`WebSocket error (user ${auth.userId}):`, err.message));

  sendToSocket(ws, {
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    roomId: auth.roomId,
    userId: auth.userId,
    serverTime: Date.now(),
    heartbeatIntervalMs: heartbeatMs,
  });
  sendToSocket(ws, { type: "presence:sync", onlineUserIds: onlineUserIds(auth.roomId) });
  if (firstConnection) sendToRoom(auth.roomId, { type: "presence:joined", userId: auth.userId });
  publishRoomInBackground(auth.roomId);
}

async function handleUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: { allowedOrigins: string[]; heartbeatMs: number }
): Promise<void> {
  // The client can vanish while we're checking credentials; an unhandled 'error' on the raw
  // socket would crash the process.
  const ignoreSocketError = () => {};
  socket.on("error", ignoreSocketError);

  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");

    const roomId = url.searchParams.get("roomId");
    if (!roomId || !isUuid(roomId)) return rejectUpgrade(socket, 400, "Bad Request");

    const auth = await authenticateUpgrade(req, url, options.allowedOrigins);
    if (auth === "forbidden-origin") return rejectUpgrade(socket, 403, "Forbidden");
    if (!auth) return rejectUpgrade(socket, 401, "Unauthorized");

    const participant = await prisma.participant.findUnique({
      where: { roomId_userId: { roomId, userId: auth.userId } },
      select: { id: true },
    });
    if (!participant) return rejectUpgrade(socket, 403, "Forbidden");
    if (socket.destroyed) return;

    socket.off("error", ignoreSocketError);
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, { roomId, ...auth }, options.heartbeatMs));
  } catch (err) {
    console.error("WebSocket upgrade failed:", err);
    rejectUpgrade(socket, 500, "Internal Server Error");
  }
}

function checkHeartbeats(): void {
  for (const [ws, info] of allClients()) {
    if (!info.isAlive) {
      // No pong since the last ping: the connection is dead (sleeping laptop, dropped
      // mobile network). Terminating fires 'close', which announces presence:left.
      ws.terminate();
      continue;
    }
    info.isAlive = false;
    ws.ping();
  }
}

export function attachWebSocketServer(server: HttpServer, options: RealtimeOptions = {}): RealtimeServer {
  const config = getConfig();
  const tickMs = options.tickMs ?? config.wsTickMs;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
  const allowedOrigins = options.allowedOrigins ?? config.clientOrigins;
  mediaResetGraceMs = options.mediaResetGraceMs ?? MEDIA_RESET_GRACE_MS;

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void handleUpgrade(wss, req, socket, head, { allowedOrigins, heartbeatMs });
  };
  server.on("upgrade", onUpgrade);

  const pulse = setInterval(() => pulseRooms(), tickMs);
  pulse.unref();
  const heartbeat = setInterval(checkHeartbeats, heartbeatMs);
  heartbeat.unref();

  return {
    wss,
    close(code = 1001, reason = "Server shutting down") {
      clearInterval(pulse);
      clearInterval(heartbeat);
      for (const timer of pendingMediaResets.values()) clearTimeout(timer);
      pendingMediaResets.clear();
      server.off("upgrade", onUpgrade);
      closeAll(code, reason);
      wss.close();
    },
  };
}
