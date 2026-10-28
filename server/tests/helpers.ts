import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import request from "supertest";
import { WebSocket } from "ws";
import { prisma } from "../src/db.js";
import { attachWebSocketServer } from "../src/ws/index.js";

export const PASSWORD = "correct-horse-battery-staple";

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
  /** Cookie-jar agent: stays signed in as this user. */
  agent: ReturnType<typeof request.agent>;
  /** The raw `name=value` session cookie, for tests that open sockets or reuse the session elsewhere. */
  cookie: string;
}

export async function registerUser(app: Express, email: string, displayName: string): Promise<TestUser> {
  const agent = request.agent(app);
  const res = await agent.post("/auth/register").send({ email, password: PASSWORD, displayName }).expect(201);
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  return { id: res.body.user.id, email, displayName, agent, cookie };
}

/** Rooms first (Room.admin is ON DELETE RESTRICT), then the users. */
export async function cleanupUsers(emails: string[]): Promise<void> {
  await prisma.room.deleteMany({ where: { admin: { email: { in: emails } } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await wait(10);
  }
}

export type Frame = { type: string; [key: string]: unknown };

export interface SocketClient {
  ws: WebSocket;
  frames: Frame[];
  /** Resolves with the close code. */
  closed: Promise<number>;
  ofType(type: string): Frame[];
}

/** An app on a real port with the room WebSocket attached, for tests that need live frames. */
export async function startRealtime(app: Express) {
  const server = http.createServer(app);
  const realtime = attachWebSocketServer(server, { heartbeatMs: 5000, mediaResetGraceMs: 400 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;

  async function connect(user: TestUser, roomId: string): Promise<SocketClient> {
    const { ticket } = (await user.agent.get("/auth/ws-ticket").expect(200)).body as { ticket: string };
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base}?roomId=${roomId}&ticket=${encodeURIComponent(ticket)}`);
      const frames: Frame[] = [];
      let ready = false;
      const closed = new Promise<number>((res) => ws.on("close", (code) => res(code)));
      ws.on("message", (data) => frames.push(JSON.parse(data.toString())));
      const client: SocketClient = { ws, frames, closed, ofType: (type) => frames.filter((f) => f.type === type) };
      // Ready once the server has registered the socket and said hello.
      ws.on("message", () => {
        if (frames.some((f) => f.type === "hello") && !ready) {
          ready = true;
          resolve(client);
        }
      });
      ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.on("error", reject);
    });
  }

  async function close(): Promise<void> {
    realtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { connect, close };
}

/** A room `admin` created (invites on), with `members` joined one after another so joinedAt strictly increases. */
export async function roomWith(admin: TestUser, name: string, members: TestUser[] = []) {
  const created = await admin.agent.post("/rooms").send({ name, inviteEnabled: true }).expect(201);
  for (const member of members) {
    await wait(5);
    await member.agent.post(`/rooms/${created.body.room.code}/join`).send({}).expect(201);
  }
  return created.body.room as { id: string; code: string; name: string };
}
