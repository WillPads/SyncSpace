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

/** Polls until `check` passes, so a slow or busy machine waits longer instead of failing. */
async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await wait(10);
  }
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

interface Client {
  ws: WebSocket;
  messages: WsMessage[];
  closed: Promise<number>;
}

function connect(url: string, cookie?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
    const messages: WsMessage[] = [];
    const closed = new Promise<number>((done) => ws.on("close", (code) => done(code)));
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    ws.on("open", () => resolve({ ws, messages, closed }));
    ws.on("error", reject);
  });
}

/** Closes sockets and waits until they're really closed, so nothing leaks into the next test. */
async function disconnect(...clients: Client[]): Promise<void> {
  for (const client of clients) client.ws.close();
  await Promise.all(clients.map((client) => client.closed));
}

describe("WebSocket engine", () => {
  const suffix = randomUUID();
  const adminEmail = `ws-admin-${suffix}@example.com`;
  const memberEmail = `ws-member-${suffix}@example.com`;
  const outsiderEmail = `ws-outsider-${suffix}@example.com`;
  const password = "correct-horse-battery-staple";

  const app = createApp();
  const server = http.createServer(app);
  const realtime = attachWebSocketServer(server);

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
    realtime.close();
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

  it("accepts a short-lived ticket from /auth/ws-ticket instead of a cookie", async () => {
    const ticketRes = await request(app).get("/auth/ws-ticket").set("Cookie", adminCookie);
    expect(ticketRes.status).toBe(200);
    const client = await connect(`${wsBase}?roomId=${roomId}&ticket=${encodeURIComponent(ticketRes.body.ticket)}`);
    await waitFor(() => client.messages.some((m) => m.type === "presence:sync"));
    await disconnect(client);
  });

  it("refuses a ws-ticket for anything but the socket, and needs a session to issue one", async () => {
    expect((await request(app).get("/auth/ws-ticket")).status).toBe(401);
    const ticketRes = await request(app).get("/auth/ws-ticket").set("Cookie", adminCookie);
    const res = await request(app).get("/auth/me").set("Cookie", `syncspace_session=${ticketRes.body.ticket}`);
    expect(res.status).toBe(401);
  });

  it("broadcasts an initial snapshot and mirrors REST-triggered updates to every connected client", async () => {
    const clientA = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);
    const clientB = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);

    const stateOf = (client: Client) => lastOfType(client.messages, "room:update")?.room.session.state;
    await waitFor(() => stateOf(clientA) === "IDLE" && stateOf(clientB) === "IDLE");

    await request(app).post(`/rooms/${roomId}/session`).set("Cookie", adminCookie).send({ action: "start" });
    await waitFor(() => stateOf(clientA) === "POMODORO_ACTIVE" && stateOf(clientB) === "POMODORO_ACTIVE");

    await disconnect(clientA, clientB);
    await request(app).post(`/rooms/${roomId}/session`).set("Cookie", adminCookie).send({ action: "endSession" });
    await request(app).post(`/rooms/${roomId}/session`).set("Cookie", adminCookie).send({ action: "reset" });
  });

  it("ticks the running timer down via periodic broadcast, without any REST call", async () => {
    await request(app).post(`/rooms/${roomId}/session`).set("Cookie", adminCookie).send({ action: "start" });
    const client = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);
    const remaining = () => lastOfType(client.messages, "room:update")?.room.session.remainingSeconds;
    await waitFor(() => remaining() !== undefined);
    const first = remaining()!;

    await waitFor(() => remaining()! < first);

    await disconnect(client);
    await request(app).post(`/rooms/${roomId}/session`).set("Cookie", adminCookie).send({ action: "pause" });
  });

  it("announces presence when a peer connects and disconnects", async () => {
    const clientA = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);
    await waitFor(() => lastOfType(clientA.messages, "presence:sync") !== undefined);
    expect(lastOfType(clientA.messages, "presence:sync")?.onlineUserIds).toContain(adminUserId);

    const clientB = await connect(`${wsBase}?roomId=${roomId}`, memberCookie);
    await waitFor(() => lastOfType(clientA.messages, "presence:joined")?.userId === memberUserId);

    await disconnect(clientB);
    await waitFor(() => lastOfType(clientA.messages, "presence:left")?.userId === memberUserId);

    await disconnect(clientA);
  });

  it("relays WebRTC signaling messages only to the targeted peer", async () => {
    const clientAdmin = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);
    const clientMember = await connect(`${wsBase}?roomId=${roomId}`, memberCookie);

    clientAdmin.ws.send(JSON.stringify({ type: "webrtc:offer", to: memberUserId, payload: { sdp: "fake-offer" } }));
    await waitFor(() => lastOfType(clientMember.messages, "webrtc:offer") !== undefined);

    expect(lastOfType(clientMember.messages, "webrtc:offer")).toMatchObject({
      from: adminUserId,
      payload: { sdp: "fake-offer" },
    });
    expect(clientAdmin.messages.some((m) => m.type === "webrtc:offer")).toBe(false);

    await disconnect(clientAdmin, clientMember);
  });

  it("persists and broadcasts a camera/mic toggle over REST", async () => {
    const client = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);

    const res = await request(app).patch(`/rooms/${roomId}/media`).set("Cookie", adminCookie).send({ cameraOn: true });
    expect(res.status).toBe(200);

    const adminCameraOn = () =>
      (lastOfType(client.messages, "room:update")?.room as unknown as { participants: { userId: string; cameraOn: boolean }[] })
        ?.participants.find((p) => p.userId === adminUserId)?.cameraOn;
    await waitFor(() => adminCameraOn() === true);

    await disconnect(client);
  });

  it("only announces presence:left once a participant's last tab closes", async () => {
    const watcher = await connect(`${wsBase}?roomId=${roomId}`, adminCookie);
    const tab1 = await connect(`${wsBase}?roomId=${roomId}`, memberCookie);
    const tab2 = await connect(`${wsBase}?roomId=${roomId}`, memberCookie);
    await waitFor(() => watcher.messages.some((m) => m.type === "presence:joined" && m.userId === memberUserId));
    const mark = watcher.messages.length;
    const leftSinceMark = () =>
      watcher.messages.slice(mark).some((m) => m.type === "presence:left" && m.userId === memberUserId);

    await disconnect(tab1);
    await wait(200); // give the server time to process the close before checking nothing was sent
    expect(leftSinceMark()).toBe(false);

    await disconnect(tab2);
    await waitFor(leftSinceMark);

    await disconnect(watcher);
  });

  it("closes a participant's socket when the admin removes them", async () => {
    const memberClient = await connect(`${wsBase}?roomId=${roomId}`, memberCookie);
    await waitFor(() => memberClient.messages.some((m) => m.type === "presence:sync"));

    const res = await request(app)
      .delete(`/rooms/${roomId}/participants/${memberUserId}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    await expect(memberClient.closed).resolves.toBe(4003);
  });
});
