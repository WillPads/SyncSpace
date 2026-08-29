import { parse as parseCookie } from "cookie";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { AUTH_COOKIE_NAME, verifyAuthToken } from "../lib/auth.js";
import { resolveAndLoadRoom, serializeRoom } from "../lib/roomView.js";
import { prisma } from "../db.js";
import { addClient, connectedRoomIds, onlineUserIds, removeClient, sendToRoom, sendToUser } from "./registry.js";

const TICK_MS = Number(process.env.WS_TICK_MS ?? 1000);

const SIGNALING_TYPES = new Set(["webrtc:offer", "webrtc:answer", "webrtc:ice-candidate"]);

export async function broadcastRoomUpdate(roomId: string): Promise<void> {
  const room = await resolveAndLoadRoom(roomId);
  if (!room) return;
  sendToRoom(roomId, { type: "room:update", room: serializeRoom(room) });
}

function handleSignalingMessage(roomId: string, fromUserId: string, raw: unknown): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;

  const message = parsed as Record<string, unknown>;
  if (typeof message.type !== "string" || !SIGNALING_TYPES.has(message.type)) return;
  if (typeof message.to !== "string") return;

  // Relayed opaque - the server never inspects SDP/ICE contents, just routes them to the target peer.
  sendToUser(roomId, message.to, { type: message.type, from: fromUserId, payload: message.payload });
}

export function attachWebSocketServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? "", "http://localhost");
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }

      const roomId = url.searchParams.get("roomId");
      const cookies = parseCookie(req.headers.cookie ?? "");
      const token = cookies[AUTH_COOKIE_NAME];
      const payload = token ? verifyAuthToken(token) : null;

      if (!roomId || !payload) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const participant = await prisma.participant.findUnique({
        where: { roomId_userId: { roomId, userId: payload.sub } },
      });
      if (!participant) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const userId = payload.sub;
        addClient(roomId, userId, ws);

        ws.send(JSON.stringify({ type: "presence:sync", onlineUserIds: onlineUserIds(roomId) }));
        sendToRoom(roomId, { type: "presence:joined", userId });
        void broadcastRoomUpdate(roomId);

        ws.on("message", (raw) => handleSignalingMessage(roomId, userId, raw));

        ws.on("close", () => {
          removeClient(ws);
          sendToRoom(roomId, { type: "presence:left", userId });
        });
        ws.on("error", () => removeClient(ws));
      });
    })();
  });

  startTickLoop();
  return wss;
}

function startTickLoop(): void {
  const interval = setInterval(() => {
    for (const roomId of connectedRoomIds()) {
      void broadcastRoomUpdate(roomId);
    }
  }, TICK_MS);
  interval.unref();
}
