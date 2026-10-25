import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

describe("room listing, tasks, and membership", () => {
  const suffix = randomUUID();
  const adminEmail = `member-admin-${suffix}@example.com`;
  const memberEmail = `member-member-${suffix}@example.com`;
  const outsiderEmail = `member-outsider-${suffix}@example.com`;
  const password = "correct-horse-battery-staple";

  const app = createApp();
  const admin = request.agent(app);
  const member = request.agent(app);
  const outsider = request.agent(app);

  let roomId = "";
  let roomCode = "";
  let adminId = "";
  let memberId = "";

  afterAll(async () => {
    await prisma.pomodoroSession.deleteMany({ where: { roomId } });
    await prisma.participant.deleteMany({ where: { roomId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, memberEmail, outsiderEmail] } } });
  });

  it("creates a room with invites already open, so a member can join straight away", async () => {
    adminId = (await admin.post("/auth/register").send({ email: adminEmail, password, displayName: "Ada Admin" }))
      .body.user.id;
    memberId = (await member.post("/auth/register").send({ email: memberEmail, password, displayName: "Mo Member" }))
      .body.user.id;
    await outsider.post("/auth/register").send({ email: outsiderEmail, password, displayName: "Out Sider" });

    const created = await admin
      .post("/rooms")
      .send({ name: "Open Room", focusDurationSec: 3000, breakDurationSec: 600, inviteEnabled: true });
    expect(created.status).toBe(201);
    expect(created.body.room.inviteEnabled).toBe(true);
    expect(created.body.room.session.focusDurationSec).toBe(3000);
    roomId = created.body.room.id;
    roomCode = created.body.room.code;

    const joined = await member.post(`/rooms/${roomCode}/join`).send({});
    expect(joined.status).toBe(201);
  });

  it("lists only the rooms the caller belongs to", async () => {
    const mine = await member.get("/rooms");
    expect(mine.status).toBe(200);
    expect(mine.body.rooms.map((r: { id: string }) => r.id)).toContain(roomId);

    const theirs = await outsider.get("/rooms");
    expect(theirs.status).toBe(200);
    expect(theirs.body.rooms.map((r: { id: string }) => r.id)).not.toContain(roomId);

    expect((await request(app).get("/rooms")).status).toBe(401);
  });

  it("stores each participant's current task and shows it in the room", async () => {
    const res = await member.patch(`/rooms/${roomId}/task`).send({ task: "  Stats problem set 4  " });
    expect(res.status).toBe(200);
    const me = res.body.room.participants.find((p: { userId: string }) => p.userId === memberId);
    expect(me.task).toBe("Stats problem set 4");

    const tooLong = await member.patch(`/rooms/${roomId}/task`).send({ task: "x".repeat(121) });
    expect(tooLong.status).toBe(400);
  });

  it("stops a member from removing someone else", async () => {
    const res = await member.delete(`/rooms/${roomId}/participants/${adminId}`);
    expect(res.status).toBe(403);
  });

  it("stops the admin from leaving their own room", async () => {
    const res = await admin.delete(`/rooms/${roomId}/participants/${adminId}`);
    expect(res.status).toBe(400);
  });

  it("lets a member leave the room themselves", async () => {
    const res = await member.delete(`/rooms/${roomId}/participants/${memberId}`);
    expect(res.status).toBe(200);
    expect(res.body.room.participants.some((p: { userId: string }) => p.userId === memberId)).toBe(false);

    expect((await member.get(`/rooms/${roomId}`)).status).toBe(403);
  });
});
