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

type WsMessage =
  | { type: "room:update"; room: { session: { state: string; isRunning: boolean; remainingSeconds: number } } }
  | { type: "presence:sync"; onlineUserIds: string[] }
  | { type: "presence:joined"; userId: string }
  | { type: "presence:left"; userId: string }
  | { type: "webrtc:offer"; from: string; payload: unknown }
  | { type: "webrtc:answer"; from: string; payload: unknown }
  | { type: "webrtc:ice-candidate"; from: string; payload: unknown };

function lastOfType<T extends WsMessage["type"]>(messages: WsMessage[], type: T) {
  return messages.filter((m): m is Extract<WsMessage, { type: T }> => m.type === type).at(-1);
}

function connect(url: string, cookie?: string): Promise<{ ws: WebSocket; messages: WsMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
    const messages: WsMessage[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    ws.on("open", () => resolve({ ws, messages }));
    ws.on("error", reject);
  });
}

describe("WebSocket engine", () => {
  const suffix = randomUUID();
  const adminEmail = `ws-admin-${suffix}@example.com`;
  const memberEmail = `ws-member-${suffix}@example.com`;
  const outsiderEmail = `ws-outsider-${suffix}@example.com`;
  const password = "correct-horse-battery-staple";

  const app = createApp();
  const server = http.createServer(app);
  attachWebSocketServer(server);

  let wsBase = "";
  let roomId = "";
  let adminCookie = "";
  let memberCookie = "";
  let outsiderCookie = "";
  let adminUserId = "";
  let memberUserId = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    wsBase = `ws://127.0.0.1:${port}/ws`;

    const adminAgent = request.agent(app);
    const adminRegRes = await adminAgent
      .post("/auth/register")
      .send({ email: adminEmail, password, displayName: "Admin" });
    adminCookie = adminRegRes.headers["set-cookie"][0].split(";")[0];
    adminUserId = adminRegRes.body.user.id;

    const memberAgent = request.agent(app);
    const memberRegRes = await memberAgent
      .post("/auth/register")
      .send({ email: memberEmail, password, displayName: "Member" });
    memberCookie = memberRegRes.headers["set-cookie"][0].split(";")[0];
    memberUserId = memberRegRes.body.user.id;

    const outsiderRegRes = await request(app)
      .post("/auth/register")
      .send({ email: outsiderEmail, password, displayName: "Outsider" });
    outsiderCookie = outsiderRegRes.headers["set-cookie"][0].split(";")[0];

    const roomRes = await adminAgent.post("/rooms").send({ name: "WS Room" });
    roomId = roomRes.body.room.id;
    await adminAgent.patch(`/rooms/${roomId}/invite`).send({ enabled: true });
    await memberAgent.post(`/rooms/${roomRes.body.room.code}/join`).send({});
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.pomodoroSession.deleteMany({ where: { roomId } });
    await prisma.participant.deleteMany({ where: { roomId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, memberEmail, outsiderEmail] } } });
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

  it("rejects a connection from a user who isn't a participant of the room", async () => {
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsBase}?roomId=${roomId}`, { headers: { Cookie: outsiderCookie } });
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
        ws.on("open", () => reject(new Error("connection should have been rejected")));
      })
    ).resolves.toBe(403);
  });

  it("broadcasts an initial snapshot and mirrors REST-triggered updates to every connected client", async () => {
    const clientA = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);
    const clientB = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);

    await wait(80);
    expect(lastOfType(clientA.messages, "room:update")?.room.session.state).toBe("IDLE");
    expect(lastOfType(clientB.messages, "room:update")?.room.session.state).toBe("IDLE");

    await request(app).post(`/rooms/${roomId}/session`).set("Cookie", adminCookie).send({ action: "start" });
    await wait(80);

    expect(lastOfType(clientA.messages, "room:update")?.room.session.state).toBe("POMODORO_ACTIVE");
    expect(lastOfType(clientB.messages, "room:update")?.room.session.state).toBe("POMODORO_ACTIVE");

    clientA.ws.close();
    clientB.ws.close();
    await request(app).post(`/rooms/${roomId}/session`).set("Cookie", adminCookie).send({ action: "reset" });
  });

  it("ticks the running timer down via periodic broadcast, without any REST call", async () => {
    await request(app).post(`/rooms/${roomId}/session`).set("Cookie", adminCookie).send({ action: "start" });
    const client = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);
    await wait(80);
    const first = lastOfType(client.messages, "room:update")?.room.session.remainingSeconds ?? Infinity;

    await wait(150);
    const second = lastOfType(client.messages, "room:update")?.room.session.remainingSeconds ?? Infinity;

    expect(second).toBeLessThan(first);
    client.ws.close();
    await request(app).post(`/rooms/${roomId}/session`).set("Cookie", adminCookie).send({ action: "pause" });
  });

  it("announces presence when a peer connects and disconnects", async () => {
    const clientA = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);
    await wait(50);

    const sync = lastOfType(clientA.messages, "presence:sync");
    expect(sync?.onlineUserIds).toContain(adminUserId);

    const clientB = await connect(`${wsBase}?roomId=${roomId}`, memberCookie);
    await wait(50);

    expect(lastOfType(clientA.messages, "presence:joined")?.userId).toBe(memberUserId);

    clientB.ws.close();
    await wait(50);
    expect(lastOfType(clientA.messages, "presence:left")?.userId).toBe(memberUserId);

    clientA.ws.close();
  });

  it("relays WebRTC signaling messages only to the targeted peer", async () => {
    const clientAdmin = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);
    const clientMember = await connect(`${wsBase}?roomId=${roomId}`, memberCookie);
    await wait(50);

    clientAdmin.ws.send(
      JSON.stringify({ type: "webrtc:offer", to: memberUserId, payload: { sdp: "fake-offer" } })
    );
    await wait(50);

    const received = lastOfType(clientMember.messages, "webrtc:offer");
    expect(received).toMatchObject({ from: adminUserId, payload: { sdp: "fake-offer" } });
    expect(clientAdmin.messages.some((m) => m.type === "webrtc:offer")).toBe(false);

    clientAdmin.ws.close();
    clientMember.ws.close();
  });

  it("persists and broadcasts a camera/mic toggle over REST", async () => {
    const client = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);
    await wait(50);

    const res = await request(app)
      .patch(`/rooms/${roomId}/media`)
      .set("Cookie", adminCookie)
      .send({ cameraOn: true });
    expect(res.status).toBe(200);

    await wait(50);
    const update = lastOfType(client.messages, "room:update");
    const adminParticipant = (update?.room as unknown as { participants: { userId: string; cameraOn: boolean }[] })
      .participants.find((p) => p.userId === adminUserId);
    expect(adminParticipant?.cameraOn).toBe(true);

    client.ws.close();
  });
});
