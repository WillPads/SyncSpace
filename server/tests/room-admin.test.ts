import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const password = "correct-horse-battery-staple";

describe("room administration", () => {
  const suffix = randomUUID();
  const adminEmail = `admin-ops-admin-${suffix}@example.com`;
  const memberEmail = `admin-ops-member-${suffix}@example.com`;
  const app = createApp();
  const admin = request.agent(app);
  const member = request.agent(app);

  let roomId = "";
  let roomCode = "";
  let memberId = "";

  beforeAll(async () => {
    await admin.post("/auth/register").send({ email: adminEmail, password, displayName: "Admin" }).expect(201);
    memberId = (await member.post("/auth/register").send({ email: memberEmail, password, displayName: "Member" }))
      .body.user.id;
    const created = await admin.post("/rooms").send({ name: "Admin Ops", inviteEnabled: true }).expect(201);
    roomId = created.body.room.id;
    roomCode = created.body.room.code;
    await member.post(`/rooms/${roomCode}/join`).send({}).expect(201);
  });

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, memberEmail] } } });
  });

  it("returns the new timer fields in room snapshots", async () => {
    const res = await admin.get(`/rooms/${roomId}`).expect(200);
    expect(res.body.room.capacity).toBe(10);
    expect(res.body.room.session).toMatchObject({ state: "IDLE", version: 0, endsAt: null });
    expect(Date.parse(res.body.room.serverTime)).not.toBeNaN();
  });

  it("validates codes, ids and durations before touching anything", async () => {
    expect((await member.post("/rooms/not-a-code/join").send({})).status).toBe(404);
    expect((await admin.get("/rooms/not-a-uuid")).status).toBe(404);
    const tooLong = await admin.post(`/rooms/${roomId}/session`).send({ action: "start", focusDurationSec: 5 * 60 * 60 });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(/at most 14400 seconds/);
    const fractional = await admin.post("/rooms").send({ name: "Bad", breakDurationSec: 90.5 });
    expect(fractional.status).toBe(400);
  });

  it("applies exactly one of two simultaneous timer actions", async () => {
    await admin.post(`/rooms/${roomId}/session`).send({ action: "start" }).expect(200);
    const [a, b] = await Promise.all([
      admin.post(`/rooms/${roomId}/session`).send({ action: "pause" }),
      admin.post(`/rooms/${roomId}/session`).send({ action: "pause" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const session = await prisma.pomodoroSession.findUniqueOrThrow({ where: { roomId } });
    expect(session.isRunning).toBe(false);
    expect(session.version).toBe(2); // start + one pause

    await admin.post(`/rooms/${roomId}/session`).send({ action: "resume" }).expect(200);
    await admin.post(`/rooms/${roomId}/session`).send({ action: "endSession" }).expect(200);
    await admin.post(`/rooms/${roomId}/session`).send({ action: "reset" }).expect(200);
  });

  it("bans someone the admin removes, until the admin lifts it", async () => {
    await admin.delete(`/rooms/${roomId}/participants/${memberId}`).expect(200);

    const rejoin = await member.post(`/rooms/${roomCode}/join`).send({});
    expect(rejoin.status).toBe(403);
    expect(rejoin.body).toEqual({ error: "The host removed you from this room.", code: "REMOVED_FROM_ROOM" });

    const bans = await admin.get(`/rooms/${roomId}/bans`).expect(200);
    expect(bans.body.bans).toEqual([{ userId: memberId, displayName: "Member", createdAt: expect.any(String) }]);

    await admin.delete(`/rooms/${roomId}/bans/${memberId}`).expect(204);
    expect((await admin.delete(`/rooms/${roomId}/bans/${memberId}`)).status).toBe(404);
    await member.post(`/rooms/${roomCode}/join`).send({}).expect(201);
  });

  it("lets a member who left on their own come back", async () => {
    await member.delete(`/rooms/${roomId}/participants/${memberId}`).expect(200);
    await member.post(`/rooms/${roomCode}/join`).send({}).expect(201);
  });

  it("keeps ban management and room deletion admin-only", async () => {
    expect((await member.get(`/rooms/${roomId}/bans`)).status).toBe(403);
    expect((await member.delete(`/rooms/${roomId}`)).status).toBe(403);
  });

  it("deletes the whole room for its admin", async () => {
    await admin.delete(`/rooms/${roomId}`).expect(204);
    expect(await prisma.room.findUnique({ where: { id: roomId } })).toBeNull();
    expect(await prisma.participant.count({ where: { roomId } })).toBe(0);
    expect(await prisma.pomodoroSession.count({ where: { roomId } })).toBe(0);
    expect((await member.get(`/rooms/${roomId}`)).status).toBe(403);
  });
});

describe("room capacity", () => {
  const suffix = randomUUID();
  const emails = Array.from({ length: 13 }, (_, i) => `capacity-${i}-${suffix}@example.com`);
  const app = createApp();
  let roomId = "";

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("never lets simultaneous joins push a room past 10 people", async () => {
    const agents = emails.map(() => request.agent(app));
    for (const [i, agent] of agents.entries()) {
      await agent.post("/auth/register").send({ email: emails[i], password, displayName: `User ${i}` }).expect(201);
    }
    const [adminAgent, ...joiners] = agents;
    const created = await adminAgent.post("/rooms").send({ name: "Full House", inviteEnabled: true }).expect(201);
    roomId = created.body.room.id;

    // 12 people race for the 9 free seats.
    const results = await Promise.all(joiners.map((agent) => agent.post(`/rooms/${created.body.room.code}/join`).send({})));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(9);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    for (const res of results.filter((r) => r.status === 409)) expect(res.body.code).toBe("ROOM_FULL");
    expect(await prisma.participant.count({ where: { roomId } })).toBe(10);
  });
});
