import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/lib/auth.js";
import { generateRoomCode } from "../src/lib/roomCode.js";
import { requireAuth } from "../src/middleware/requireAuth.js";
import { requireRoomRole } from "../src/middleware/requireRoomRole.js";

describe("requireRoomRole", () => {
  const suffix = randomUUID();
  const adminEmail = `rbac-admin-${suffix}@example.com`;
  const memberEmail = `rbac-member-${suffix}@example.com`;
  const outsiderEmail = `rbac-outsider-${suffix}@example.com`;
  const password = "correct-horse-battery-staple";

  const app = createApp();
  app.get("/rooms/:roomId/admin-only", requireAuth, requireRoomRole("ADMIN"), (_req, res) => {
    res.json({ ok: true });
  });

  let roomId = "";

  beforeAll(async () => {
    const passwordHash = await hashPassword(password);
    const admin = await prisma.user.create({
      data: { email: adminEmail, passwordHash, displayName: "Admin" },
    });
    const member = await prisma.user.create({
      data: { email: memberEmail, passwordHash, displayName: "Member" },
    });
    await prisma.user.create({ data: { email: outsiderEmail, passwordHash, displayName: "Outsider" } });

    const room = await prisma.room.create({
      data: { code: generateRoomCode(), name: "RBAC Test Room", adminId: admin.id },
    });
    roomId = room.id;

    await prisma.participant.create({ data: { roomId, userId: admin.id, role: "ADMIN" } });
    await prisma.participant.create({ data: { roomId, userId: member.id, role: "MEMBER" } });
  });

  afterAll(async () => {
    await prisma.participant.deleteMany({ where: { roomId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, memberEmail, outsiderEmail] } } });
  });

  it("blocks unauthenticated requests", async () => {
    const res = await request(app).get(`/rooms/${roomId}/admin-only`);
    expect(res.status).toBe(401);
  });

  it("allows the room admin", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email: adminEmail, password });
    const res = await agent.get(`/rooms/${roomId}/admin-only`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("blocks a plain member from an admin-only route", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email: memberEmail, password });
    const res = await agent.get(`/rooms/${roomId}/admin-only`);
    expect(res.status).toBe(403);
  });

  it("blocks a user who isn't a participant of the room", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email: outsiderEmail, password });
    const res = await agent.get(`/rooms/${roomId}/admin-only`);
    expect(res.status).toBe(403);
  });
});
