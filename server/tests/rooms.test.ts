import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

describe("rooms & FSM", () => {
  const suffix = randomUUID();
  const adminEmail = `rooms-admin-${suffix}@example.com`;
  const memberEmail = `rooms-member-${suffix}@example.com`;
  const outsiderEmail = `rooms-outsider-${suffix}@example.com`;
  const password = "correct-horse-battery-staple";

  const app = createApp();
  const adminAgent = request.agent(app);
  const memberAgent = request.agent(app);
  const outsiderAgent = request.agent(app);

  let roomId = "";
  let roomCode = "";

  afterAll(async () => {
    if (roomId) {
      await prisma.pomodoroSession.deleteMany({ where: { roomId } });
      await prisma.participant.deleteMany({ where: { roomId } });
      await prisma.room.deleteMany({ where: { id: roomId } });
    }
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, memberEmail, outsiderEmail] } } });
  });

  it("registers the three test users", async () => {
    for (const [agent, email, displayName] of [
      [adminAgent, adminEmail, "Admin"],
      [memberAgent, memberEmail, "Member"],
      [outsiderAgent, outsiderEmail, "Outsider"],
    ] as const) {
      const res = await agent.post("/auth/register").send({ email, password, displayName });
      expect(res.status).toBe(201);
    }
  });

  it("creates a room, making the creator its admin", async () => {
    const res = await adminAgent.post("/rooms").send({ name: "Deep Work" });
    expect(res.status).toBe(201);
    expect(res.body.room.session.state).toBe("IDLE");
    expect(res.body.room.participants).toHaveLength(1);
    expect(res.body.room.participants[0].role).toBe("ADMIN");
    roomId = res.body.room.id;
    roomCode = res.body.room.code;
  });

  it("blocks a non-admin from joining while invites are disabled", async () => {
    const res = await memberAgent.post(`/rooms/${roomCode}/join`).send({});
    expect(res.status).toBe(403);
  });

  it("lets the admin enable invites", async () => {
    const res = await adminAgent.patch(`/rooms/${roomId}/invite`).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.room.inviteEnabled).toBe(true);
  });

  it("lets a member join once invites are enabled", async () => {
    const res = await memberAgent.post(`/rooms/${roomCode}/join`).send({});
    expect(res.status).toBe(201);
    expect(res.body.room.participants).toHaveLength(2);
  });

  it("is idempotent when the same user joins again", async () => {
    const res = await memberAgent.post(`/rooms/${roomCode}/join`).send({});
    expect(res.status).toBe(200);
    expect(res.body.room.participants).toHaveLength(2);
  });

  it("blocks a non-participant from reading the room", async () => {
    const res = await outsiderAgent.get(`/rooms/${roomId}`);
    expect(res.status).toBe(403);
  });

  it("blocks a member from starting the session", async () => {
    const res = await memberAgent.post(`/rooms/${roomId}/session`).send({ action: "start" });
    expect(res.status).toBe(403);
  });

  it("runs the admin through the full FSM cycle", async () => {
    let res = await adminAgent.post(`/rooms/${roomId}/session`).send({ action: "start" });
    expect(res.status).toBe(200);
    expect(res.body.room.session.state).toBe("POMODORO_ACTIVE");
    expect(res.body.room.session.isRunning).toBe(true);

    res = await adminAgent.post(`/rooms/${roomId}/session`).send({ action: "pause" });
    expect(res.status).toBe(200);
    expect(res.body.room.session.isRunning).toBe(false);

    res = await adminAgent.post(`/rooms/${roomId}/session`).send({ action: "resume" });
    expect(res.status).toBe(200);
    expect(res.body.room.session.isRunning).toBe(true);

    res = await adminAgent.post(`/rooms/${roomId}/session`).send({ action: "skip" });
    expect(res.status).toBe(200);
    expect(res.body.room.session.state).toBe("BREAK");

    res = await adminAgent.post(`/rooms/${roomId}/session`).send({ action: "endSession" });
    expect(res.status).toBe(200);
    expect(res.body.room.session.state).toBe("QUIZ_PHASE");

    res = await adminAgent.post(`/rooms/${roomId}/session`).send({ action: "start" });
    expect(res.status).toBe(409);

    res = await adminAgent.post(`/rooms/${roomId}/session`).send({ action: "reset" });
    expect(res.status).toBe(200);
    expect(res.body.room.session.state).toBe("IDLE");
  });

  it("rejects a sub-minute focus duration on start", async () => {
    const res = await adminAgent
      .post(`/rooms/${roomId}/session`)
      .send({ action: "start", focusDurationSec: 30 });
    expect(res.status).toBe(400);
  });

  it("blocks a member from removing a participant", async () => {
    const res = await memberAgent.delete(`/rooms/${roomId}/participants/${adminEmail}`);
    expect(res.status).toBe(403);
  });

  it("lets the admin remove a participant", async () => {
    const meRes = await memberAgent.get("/auth/me");
    const memberUserId = meRes.body.user.id;

    const res = await adminAgent.delete(`/rooms/${roomId}/participants/${memberUserId}`);
    expect(res.status).toBe(200);
    expect(res.body.room.participants).toHaveLength(1);
  });
});
