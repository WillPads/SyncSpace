import { parse as parseCookie } from "cookie";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { AUTH_COOKIE_NAME, verifyAuthToken } from "../lib/auth.js";
import { resolveAndLoadRoom, serializeRoom } from "../lib/roomView.js";
import { prisma } from "../db.js";
import { addClient, connectedRoomIds, removeClient, sendToRoom } from "./registry.js";

const TICK_MS = Number(process.env.WS_TICK_MS ?? 1000);

export async function broadcastRoomUpdate(roomId: string): Promise<void> {
  const room = await resolveAndLoadRoom(roomId);
  if (!room) return;
  sendToRoom(roomId, { type: "room:update", room: serializeRoom(room) });
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
        addClient(roomId, payload.sub, ws);
        void broadcastRoomUpdate(roomId);

        ws.on("close", () => removeClient(ws));
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
