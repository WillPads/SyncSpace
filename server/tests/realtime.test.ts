import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { attachWebSocketServer } from "../src/ws/index.js";

type Message = { type: string; [key: string]: unknown };

interface Client {
  ws: WebSocket;
  messages: Message[];
  closed: Promise<number>;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await wait(10);
  }
}

function open(url: string, headers?: Record<string, string>): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, headers ? { headers } : undefined);
    const messages: Message[] = [];
    const closed = new Promise<number>((res) => ws.on("close", (code) => res(code)));
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    ws.on("open", () => resolve({ ws, messages, closed }));
    ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on("error", reject);
  });
}

function rejectedStatus(url: string, headers?: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, headers ? { headers } : undefined);
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("open", () => reject(new Error("connection should have been rejected")));
    ws.on("error", () => {});
  });
}

describe("realtime protocol", () => {
  const suffix = randomUUID();
  const password = "correct-horse-battery-staple";
  const adminEmail = `rt-admin-${suffix}@example.com`;
  const memberEmail = `rt-member-${suffix}@example.com`;

  const app = createApp();
  const server = http.createServer(app);
  const realtime = attachWebSocketServer(server, { heartbeatMs: 200, mediaResetGraceMs: 400 });

  let base = "";
  let roomId = "";
  let roomCode = "";
  let adminCookie = "";
  let memberCookie = "";
  let adminId = "";
  let memberId = "";

  const roomUrl = (id = roomId) => `${base}?roomId=${id}`;
  const ticketFor = async (cookie: string) =>
    (await request(app).get("/auth/ws-ticket").set("Cookie", cookie).expect(200)).body.ticket as string;
  const openWithTicket = async (cookie: string, id = roomId) =>
    open(`${roomUrl(id)}&ticket=${encodeURIComponent(await ticketFor(cookie))}`);

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;

    const adminReg = await request(app).post("/auth/register").send({ email: adminEmail, password, displayName: "Admin" });
    adminCookie = adminReg.headers["set-cookie"][0].split(";")[0];
    adminId = adminReg.body.user.id;
    const memberReg = await request(app).post("/auth/register").send({ email: memberEmail, password, displayName: "Member" });
    memberCookie = memberReg.headers["set-cookie"][0].split(";")[0];
    memberId = memberReg.body.user.id;

    const room = await request(app).post("/rooms").set("Cookie", adminCookie).send({ name: "RT", inviteEnabled: true });
    roomId = room.body.room.id;
    roomCode = room.body.room.code;
    await request(app).post(`/rooms/${roomCode}/join`).set("Cookie", memberCookie).send({}).expect(201);
  });

  afterAll(async () => {
    realtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.room.deleteMany({ where: { admin: { email: { in: [adminEmail, memberEmail] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, memberEmail] } } });
  });

  it("starts every connection with a hello, then presence and a room snapshot", async () => {
    const client = await openWithTicket(adminCookie);
    await waitFor(() => client.messages.some((m) => m.type === "room:update"));
    expect(client.messages[0]).toMatchObject({ type: "hello", protocolVersion: 1, roomId, userId: adminId });
    expect(client.messages[1]).toMatchObject({ type: "presence:sync", onlineUserIds: [adminId] });

    const update = client.messages.find((m) => m.type === "room:update") as unknown as {
      room: { serverTime: string; session: object };
    };
    expect(Date.parse(update.room.serverTime)).not.toBeNaN();
    expect(update.room.session).toMatchObject({ state: "IDLE", version: 0, endsAt: null });
    client.ws.close();
    await client.closed;
  });

  it("lets a ticket open exactly one socket", async () => {
    const ticket = await ticketFor(memberCookie);
    const first = await open(`${roomUrl()}&ticket=${encodeURIComponent(ticket)}`);
    expect(await rejectedStatus(`${roomUrl()}&ticket=${encodeURIComponent(ticket)}`)).toBe(401);
    first.ws.close();
    await first.closed;
  });

  it("only accepts the session cookie from the app's own origin", async () => {
    expect(await rejectedStatus(roomUrl(), { Cookie: adminCookie, Origin: "https://evil.example" })).toBe(403);
    const ok = await open(roomUrl(), { Cookie: adminCookie, Origin: "http://localhost:3000" });
    ok.ws.close();
    await ok.closed;
  });

  it("rejects a malformed room id before checking credentials", async () => {
    expect(await rejectedStatus(`${base}?roomId=not-a-room`)).toBe(400);
  });

  it("answers time pings with the server clock", async () => {
    const client = await openWithTicket(adminCookie);
    const before = Date.now();
    client.ws.send(JSON.stringify({ type: "time:ping", clientTime: 12345 }));
    await waitFor(() => client.messages.some((m) => m.type === "time:pong"));
    const pong = client.messages.find((m) => m.type === "time:pong")!;
    expect(pong.clientTime).toBe(12345);
    expect(pong.serverTime as number).toBeGreaterThanOrEqual(before);
    client.ws.close();
    await client.closed;
  });

  it("reports malformed messages without dropping the connection", async () => {
    const client = await openWithTicket(adminCookie);
    client.ws.send("{nope");
    client.ws.send(JSON.stringify({ type: "webrtc:offer", to: "not-a-uuid", payload: {} }));
    client.ws.send(JSON.stringify({ type: "webrtc:offer", to: adminId, payload: {} }));
    await waitFor(() => client.messages.filter((m) => m.type === "error").length === 3);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    client.ws.close();
    await client.closed;
  });

  it("tells the sender when a signaling target isn't connected", async () => {
    const client = await openWithTicket(adminCookie);
    client.ws.send(JSON.stringify({ type: "webrtc:offer", to: memberId, payload: { sdp: "x" } }));
    await waitFor(() => client.messages.some((m) => m.type === "webrtc:peer-unavailable"));
    expect(client.messages.find((m) => m.type === "webrtc:peer-unavailable")).toEqual({
      type: "webrtc:peer-unavailable",
      userId: memberId,
    });
    client.ws.close();
    await client.closed;
  });

  it("announces a user once, however many tabs they open", async () => {
    const watcher = await openWithTicket(adminCookie);
    const tab1 = await openWithTicket(memberCookie);
    const tab2 = await openWithTicket(memberCookie);
    await wait(100);
    expect(watcher.messages.filter((m) => m.type === "presence:joined" && m.userId === memberId)).toHaveLength(1);
    for (const c of [tab1, tab2, watcher]) c.ws.close();
    await Promise.all([tab1.closed, tab2.closed, watcher.closed]);
  });

  it("closes a socket that floods messages", async () => {
    const client = await openWithTicket(adminCookie);
    for (let i = 0; i < 260; i++) client.ws.send(JSON.stringify({ type: "time:ping", clientTime: i }));
    expect(await client.closed).toBe(1008);
  });

  it("closes a socket that sends an oversized frame", async () => {
    const client = await openWithTicket(adminCookie);
    client.ws.send("x".repeat(70 * 1024));
    expect(await client.closed).toBe(1009);
  });

  it("drops a connection that stops answering heartbeats, and tells the room", async () => {
    const watcher = await openWithTicket(adminCookie);
    const silent = await openWithTicket(memberCookie);
    await waitFor(() => watcher.messages.some((m) => m.type === "presence:joined" && m.userId === memberId));

    // Stop reading from the socket: pings go unanswered, like a laptop that went to sleep.
    (silent.ws as unknown as { _socket: { pause(): void } })._socket.pause();
    await waitFor(() => watcher.messages.some((m) => m.type === "presence:left" && m.userId === memberId), 3000);
    watcher.ws.close();
    await watcher.closed;
  });

  it("keeps camera and mic flags across a quick reconnect, like a page refresh", async () => {
    const before = await openWithTicket(adminCookie);
    await request(app).patch(`/rooms/${roomId}/media`).set("Cookie", adminCookie).send({ cameraOn: true }).expect(200);
    before.ws.close();
    await before.closed;
    const after = await openWithTicket(adminCookie); // back within the grace period
    await wait(800); // well past it
    expect((await prisma.participant.findFirstOrThrow({ where: { roomId, userId: adminId } })).cameraOn).toBe(true);
    after.ws.close();
    await after.closed;
  });

  it("clears camera and mic flags when someone's last socket closes", async () => {
    const client = await openWithTicket(adminCookie);
    await request(app).patch(`/rooms/${roomId}/media`).set("Cookie", adminCookie).send({ cameraOn: true, micOn: true }).expect(200);
    client.ws.close();
    await client.closed;
    await expect
      .poll(async () => prisma.participant.findFirstOrThrow({ where: { roomId, userId: adminId } }), { timeout: 3000 })
      .toMatchObject({ cameraOn: false, micOn: false });
  });

  it("closes a session's sockets the moment it signs out", async () => {
    const login = await request(app).post("/auth/login").send({ email: memberEmail, password });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const client = await openWithTicket(cookie);
    await request(app).post("/auth/logout").set("Cookie", cookie).expect(204);
    expect(await client.closed).toBe(4001);
  });

  it("tells everyone and closes their sockets when the room is deleted", async () => {
    const doomed = await request(app).post("/rooms").set("Cookie", adminCookie).send({ name: "Doomed", inviteEnabled: true });
    const doomedId = doomed.body.room.id;
    await request(app).post(`/rooms/${doomed.body.room.code}/join`).set("Cookie", memberCookie).send({}).expect(201);
    const client = await openWithTicket(memberCookie, doomedId);

    await request(app).delete(`/rooms/${doomedId}`).set("Cookie", adminCookie).expect(204);
    expect(await client.closed).toBe(4004);
    expect(client.messages.some((m) => m.type === "room:deleted" && m.roomId === doomedId)).toBe(true);
  });
});
