import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { attachWebSocketServer } from "../src/ws/index.js";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RoomUpdateMessage {
  type: "room:update";
  room: { session: { state: string; isRunning: boolean; remainingSeconds: number } };
}

function connect(url: string, cookie?: string): Promise<{ ws: WebSocket; messages: RoomUpdateMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
    const messages: RoomUpdateMessage[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    ws.on("open", () => resolve({ ws, messages }));
    ws.on("error", reject);
  });
}

describe("WebSocket engine", () => {
  const suffix = randomUUID();
  const adminEmail = `ws-admin-${suffix}@example.com`;
  const password = "correct-horse-battery-staple";

  const app = createApp();
  const server = http.createServer(app);
  attachWebSocketServer(server);

  let wsBase = "";
  let roomId = "";
  let cookieHeader = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    wsBase = `ws://127.0.0.1:${port}/ws`;

    const agent = request.agent(app);
    const registerRes = await agent
      .post("/auth/register")
      .send({ email: adminEmail, password, displayName: "Admin" });
    cookieHeader = registerRes.headers["set-cookie"][0].split(";")[0];

    const roomRes = await agent.post("/rooms").send({ name: "WS Room" });
    roomId = roomRes.body.room.id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.pomodoroSession.deleteMany({ where: { roomId } });
    await prisma.participant.deleteMany({ where: { roomId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
  });

  it("rejects a connection with no valid session cookie", async () => {
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsBase}?roomId=${roomId}`);
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
        ws.on("open", () => reject(new Error("connection should have been rejected")));
      })
    ).resolves.toBe(401);
  });

  it("broadcasts an initial snapshot and mirrors REST-triggered updates to every connected client", async () => {
    const clientA = await connect(`${wsBase}?roomId=${roomId}`, cookieHeader);
    const clientB = await connect(`${wsBase}?roomId=${roomId}`, cookieHeader);

    await wait(80);
    expect(clientA.messages.at(-1)?.room.session.state).toBe("IDLE");
    expect(clientB.messages.at(-1)?.room.session.state).toBe("IDLE");

    await request(app).post(`/rooms/${roomId}/session`).set("Cookie", cookieHeader).send({ action: "start" });
    await wait(80);

    expect(clientA.messages.at(-1)?.room.session.state).toBe("POMODORO_ACTIVE");
    expect(clientB.messages.at(-1)?.room.session.state).toBe("POMODORO_ACTIVE");

    clientA.ws.close();
    clientB.ws.close();
  });

  it("ticks the running timer down via periodic broadcast, without any REST call", async () => {
    const client = await connect(`${wsBase}?roomId=${roomId}`, cookieHeader);
    await wait(80);
    const first = client.messages.at(-1)?.room.session.remainingSeconds ?? Infinity;

    await wait(150);
    const second = client.messages.at(-1)?.room.session.remainingSeconds ?? Infinity;

    expect(second).toBeLessThan(first);
    client.ws.close();
  });
});
