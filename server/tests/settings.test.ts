import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { processDocument, uploadDir } from "../src/lib/documentPipeline.js";
import { PASSWORD, cleanupUsers, registerUser, roomWith, startRealtime, wait, waitFor } from "./helpers.js";

const suffix = randomUUID();
const emails: string[] = [];
const newEmail = (label: string) => {
  const email = `settings-${label}-${suffix}@example.com`;
  emails.push(email);
  return email;
};
const NEW_PASSWORD = "a-brand-new-passphrase";

afterAll(() => cleanupUsers(emails));

describe("PATCH /auth/me", () => {
  const app = createApp();

  it("requires a session", async () => {
    const res = await request(app).patch("/auth/me").send({ displayName: "X" });
    expect(res.status).toBe(401);
  });

  it("changes the display name without a password and returns the same shape as GET /auth/me", async () => {
    const u = await registerUser(app, newEmail("name"), "Before");
    const res = await u.agent.patch("/auth/me").send({ displayName: "  After  " }).expect(200);
    expect(res.body).toEqual({ user: { id: u.id, email: u.email, displayName: "After" } });
    expect((await u.agent.get("/auth/me")).body).toEqual(res.body);
  });

  it("validates the input", async () => {
    const u = await registerUser(app, newEmail("validate"), "Valid");
    expect((await u.agent.patch("/auth/me").send({})).body.code).toBe("VALIDATION_ERROR");
    expect((await u.agent.patch("/auth/me").send({ displayName: "   " })).status).toBe(400);
    expect((await u.agent.patch("/auth/me").send({ displayName: "x".repeat(41) })).status).toBe(400);
    expect((await u.agent.patch("/auth/me").send({ email: "not-an-email", currentPassword: PASSWORD })).status).toBe(400);
    // A new email needs the password.
    const noPassword = await u.agent.patch("/auth/me").send({ email: newEmail("validate-new") });
    expect(noPassword.status).toBe(400);
    expect(noPassword.body.code).toBe("VALIDATION_ERROR");
  });

  it("answers a wrong password with 403 INVALID_PASSWORD and keeps the session", async () => {
    const u = await registerUser(app, newEmail("wrongpw"), "Wrong");
    const res = await u.agent.patch("/auth/me").send({ email: newEmail("wrongpw-new"), currentPassword: "nope-nope-nope" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INVALID_PASSWORD");
    await u.agent.get("/auth/me").expect(200);
  });

  it("changes the email (lowercased) with the right password, and the new one signs in", async () => {
    const u = await registerUser(app, newEmail("change"), "Changer");
    const target = newEmail("changed");
    const res = await u.agent.patch("/auth/me").send({ email: target.toUpperCase(), currentPassword: PASSWORD }).expect(200);
    expect(res.body.user.email).toBe(target);
    await request(app).post("/auth/login").send({ email: target, password: PASSWORD }).expect(200);
    await request(app).post("/auth/login").send({ email: u.email, password: PASSWORD }).expect(401);
  });

  it("answers an email that belongs to someone else with 409 EMAIL_TAKEN", async () => {
    const taken = await registerUser(app, newEmail("taken"), "Taken");
    const u = await registerUser(app, newEmail("wants-taken"), "Wants");
    const res = await u.agent.patch("/auth/me").send({ email: taken.email, currentPassword: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
  });

  it("treats re-sending the current email as no change (no password needed)", async () => {
    const u = await registerUser(app, newEmail("same"), "Same");
    const res = await u.agent.patch("/auth/me").send({ email: u.email.toUpperCase(), displayName: "Same" }).expect(200);
    expect(res.body.user.email).toBe(u.email);
  });

  it("limits profile edits to a few per hour per user", async () => {
    const limited = createApp({ rateLimits: { profileUpdatePerUser: { windowMs: 60_000, max: 2 } } });
    const u = await registerUser(limited, newEmail("rl"), "Limited");
    await u.agent.patch("/auth/me").send({ displayName: "One" }).expect(200);
    await u.agent.patch("/auth/me").send({ displayName: "Two" }).expect(200);
    const res = await u.agent.patch("/auth/me").send({ displayName: "Three" });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("counts wrong passwords against the same per-account limiter as sign-in", async () => {
    const strict = createApp({ rateLimits: { loginFailuresPerAccount: { windowMs: 60_000, max: 2 } } });
    const u = await registerUser(strict, newEmail("lockout"), "Lock");
    const guess = () => u.agent.patch("/auth/me").send({ email: newEmail("lockout-new"), currentPassword: "wrong-guess-1" });
    expect((await guess()).status).toBe(403);
    expect((await guess()).status).toBe(403);
    // Locked now: even the right password is refused, and so is signing in.
    const locked = await u.agent.patch("/auth/me").send({ email: newEmail("lockout-new2"), currentPassword: PASSWORD });
    expect(locked.status).toBe(429);
    await request(strict).post("/auth/login").send({ email: u.email, password: PASSWORD }).expect(429);
  });

  it("pushes a fresh room snapshot to open rooms when the name changes", async () => {
    const live = await startRealtime(app);
    try {
      const admin = await registerUser(app, newEmail("live-admin"), "Old Name");
      const roomId = (await admin.agent.post("/rooms").send({ name: "Live" }).expect(201)).body.room.id;
      const socket = await live.connect(admin, roomId);
      await admin.agent.patch("/auth/me").send({ displayName: "New Name" }).expect(200);
      await waitFor(() =>
        socket.ofType("room:update").some((f) =>
          (f.room as { participants: { displayName: string }[] }).participants.some((p) => p.displayName === "New Name")
        )
      );
      socket.ws.close();
    } finally {
      await live.close();
    }
  });
});

describe("POST /auth/change-password", () => {
  const app = createApp();

  it("requires a session", async () => {
    const res = await request(app).post("/auth/change-password").send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("validates, and answers a wrong current password with 403 INVALID_PASSWORD", async () => {
    const u = await registerUser(app, newEmail("pw-validate"), "Pw");
    expect((await u.agent.post("/auth/change-password").send({ newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await u.agent.post("/auth/change-password").send({ currentPassword: PASSWORD, newPassword: "short" })).status).toBe(400);
    const same = await u.agent.post("/auth/change-password").send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.code).toBe("VALIDATION_ERROR");

    const wrong = await u.agent.post("/auth/change-password").send({ currentPassword: "not-the-password", newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("INVALID_PASSWORD");
    await u.agent.get("/auth/me").expect(200);
  });

  it("changes the password, revokes every other session, but keeps the current one", async () => {
    const live = await startRealtime(app);
    try {
      const u = await registerUser(app, newEmail("pw-change"), "Changer");
      const room = await u.agent.post("/rooms").send({ name: "Pw" }).expect(201);
      const other = request.agent(app);
      await other.post("/auth/login").send({ email: u.email, password: PASSWORD }).expect(200);
      const third = request.agent(app);
      await third.post("/auth/login").send({ email: u.email, password: PASSWORD }).expect(200);
      expect(await prisma.session.count({ where: { userId: u.id } })).toBe(3);

      const currentSocket = await live.connect(u, room.body.room.id);
      const otherSocket = await live.connect({ ...u, agent: other }, room.body.room.id);

      await u.agent.post("/auth/change-password").send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(204);

      await other.get("/auth/me").expect(401);
      await third.get("/auth/me").expect(401);
      await u.agent.get("/auth/me").expect(200);
      expect(await prisma.session.count({ where: { userId: u.id } })).toBe(1);
      expect(await otherSocket.closed).toBe(4001);
      await wait(150);
      expect(currentSocket.ws.readyState).toBe(currentSocket.ws.OPEN);
      currentSocket.ws.close();

      await request(app).post("/auth/login").send({ email: u.email, password: PASSWORD }).expect(401);
      await request(app).post("/auth/login").send({ email: u.email, password: NEW_PASSWORD }).expect(200);
    } finally {
      await live.close();
    }
  });

  it("limits password changes", async () => {
    const limited = createApp({ rateLimits: { changePasswordPerUser: { windowMs: 60_000, max: 2 } } });
    const u = await registerUser(limited, newEmail("pw-rl"), "Limited");
    for (let i = 0; i < 2; i++) {
      await u.agent.post("/auth/change-password").send({ currentPassword: "wrong-wrong-1", newPassword: NEW_PASSWORD }).expect(403);
    }
    const res = await u.agent.post("/auth/change-password").send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(429);
  });
});

describe("POST /auth/delete-account", () => {
  const app = createApp();

  it("requires a session, a password, and the right password", async () => {
    expect((await request(app).post("/auth/delete-account").send({ password: PASSWORD })).status).toBe(401);
    const u = await registerUser(app, newEmail("del-guard"), "Guard");
    expect((await u.agent.post("/auth/delete-account").send({})).body.code).toBe("VALIDATION_ERROR");
    const wrong = await u.agent.post("/auth/delete-account").send({ password: "not-the-password" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("INVALID_PASSWORD");
    await u.agent.get("/auth/me").expect(200);
    expect(await prisma.user.count({ where: { id: u.id } })).toBe(1);
  });

  it("limits attempts", async () => {
    const limited = createApp({ rateLimits: { deleteAccountPerUser: { windowMs: 60_000, max: 1 } } });
    const u = await registerUser(limited, newEmail("del-rl"), "Limited");
    await u.agent.post("/auth/delete-account").send({ password: "wrong-wrong-1" }).expect(403);
    expect((await u.agent.post("/auth/delete-account").send({ password: PASSWORD })).status).toBe(429);
  });

  it("deletes the user, their sessions and the cookie, and a sole-member room goes with them", async () => {
    const u = await registerUser(app, newEmail("del-solo"), "Solo");
    const room = await roomWith(u, "Solo room", []);
    const other = request.agent(app);
    await other.post("/auth/login").send({ email: u.email, password: PASSWORD }).expect(200);

    const res = await u.agent.post("/auth/delete-account").send({ password: PASSWORD });
    expect(res.status).toBe(204);
    expect(([] as string[]).concat(res.headers["set-cookie"] ?? []).join(";")).toMatch(/syncspace_session=;/);

    expect(await prisma.user.count({ where: { id: u.id } })).toBe(0);
    expect(await prisma.room.count({ where: { id: room.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
    await other.get("/auth/me").expect(401);
    await request(app).post("/auth/login").send({ email: u.email, password: PASSWORD }).expect(401);
  });

  it("hands a room with other members to the earliest joiner", async () => {
    const admin = await registerUser(app, newEmail("del-admin"), "Admin");
    const first = await registerUser(app, newEmail("del-first"), "First");
    const second = await registerUser(app, newEmail("del-second"), "Second");
    const room = await roomWith(admin, "Handover", [first, second]);

    await admin.agent.post("/auth/delete-account").send({ password: PASSWORD }).expect(204);

    const after = await prisma.room.findUniqueOrThrow({ where: { id: room.id }, include: { participants: true } });
    expect(after.adminId).toBe(first.id);
    expect(after.participants.find((p) => p.userId === first.id)?.role).toBe("ADMIN");
    expect(after.participants.find((p) => p.userId === second.id)?.role).toBe("MEMBER");
    expect(after.participants).toHaveLength(2);
    // The new admin can really use admin powers.
    await first.agent.patch(`/rooms/${room.id}/invite`).send({ enabled: false }).expect(200);
    await second.agent.patch(`/rooms/${room.id}/invite`).send({ enabled: true }).expect(403);
  });

  it("handles a user who admins several rooms, deciding each one separately", async () => {
    const admin = await registerUser(app, newEmail("multi-admin"), "Multi");
    const friend = await registerUser(app, newEmail("multi-friend"), "Friend");
    const later = await registerUser(app, newEmail("multi-later"), "Later");
    const shared = await roomWith(admin, "Shared", [friend]);
    const alone = await roomWith(admin, "Alone", []);
    const crowd = await roomWith(admin, "Crowd", [later, friend]);
    const theirs = await roomWith(friend, "Friend's own", [admin]);

    await admin.agent.post("/auth/delete-account").send({ password: PASSWORD }).expect(204);

    expect((await prisma.room.findUniqueOrThrow({ where: { id: shared.id } })).adminId).toBe(friend.id);
    expect(await prisma.room.count({ where: { id: alone.id } })).toBe(0);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: crowd.id } })).adminId).toBe(later.id);
    // A room they only belonged to is untouched apart from losing a member.
    const untouched = await prisma.room.findUniqueOrThrow({ where: { id: theirs.id }, include: { participants: true } });
    expect(untouched.adminId).toBe(friend.id);
    expect(untouched.participants.map((p) => p.userId)).toEqual([friend.id]);
  });

  it("keeps their chat, documents, quizzes and scheduled sessions in rooms that stay, with the author nulled", async () => {
    const admin = await registerUser(app, newEmail("keep-admin"), "Leaver");
    const stayer = await registerUser(app, newEmail("keep-stayer"), "Stayer");
    const room = await roomWith(admin, "Keep", [stayer]);

    await prisma.chatMessage.create({ data: { roomId: room.id, authorId: admin.id, body: "bye" } });
    await prisma.scheduledSession.create({
      data: { roomId: room.id, createdById: admin.id, startsAt: new Date(Date.now() + 3_600_000), durationMin: 30 },
    });
    const ready = await prisma.document.create({
      data: { roomId: room.id, uploadedById: admin.id, filename: "ready.txt", storagePath: "gone.txt", mimeType: "text/plain", status: "READY" },
    });
    const quiz = await prisma.quiz.create({ data: { roomId: room.id, documentId: ready.id, title: "Quiz: ready.txt" } });
    // An upload still waiting to be processed: the room stays, so the pipeline finishes it later.
    const leftover = `${randomUUID()}.txt`;
    fs.writeFileSync(path.join(uploadDir(), leftover), "pending notes");
    const pending = await prisma.document.create({
      data: { roomId: room.id, uploadedById: admin.id, filename: "pending.txt", storagePath: leftover, mimeType: "text/plain" },
    });

    await admin.agent.post("/auth/delete-account").send({ password: PASSWORD }).expect(204);

    expect((await prisma.chatMessage.findFirstOrThrow({ where: { roomId: room.id } })).authorId).toBeNull();
    expect((await prisma.scheduledSession.findFirstOrThrow({ where: { roomId: room.id } })).createdById).toBeNull();
    expect((await prisma.document.findUniqueOrThrow({ where: { id: ready.id } })).uploadedById).toBeNull();
    expect((await prisma.document.findUniqueOrThrow({ where: { id: pending.id } })).uploadedById).toBeNull();
    expect(await prisma.quiz.count({ where: { id: quiz.id } })).toBe(1);
    // Account deletion leaves the file for the pipeline ...
    expect(fs.existsSync(path.join(uploadDir(), leftover))).toBe(true);
    // ... which processes the document even though its uploader is gone, then removes the file.
    await processDocument(pending.id, { llm: null });
    const processed = await prisma.document.findUniqueOrThrow({ where: { id: pending.id } });
    expect(processed.status).toBe("READY");
    expect(processed.uploadedById).toBeNull();
    expect(processed.parsedText).toBe("pending notes");
    expect(fs.existsSync(path.join(uploadDir(), leftover))).toBe(false);

    // The documents list shows an unknown uploader as null instead of failing.
    const list = await stayer.agent.get(`/rooms/${room.id}/documents`).expect(200);
    expect(list.body.documents.map((d: { uploadedById: string | null }) => d.uploadedById)).toEqual([null, null]);
  });

  it("removes the upload files of a room that is deleted with the account", async () => {
    const u = await registerUser(app, newEmail("del-files"), "Files");
    const room = await roomWith(u, "Files", []);
    const leftover = `${randomUUID()}.txt`;
    fs.writeFileSync(path.join(uploadDir(), leftover), "pending notes");
    await prisma.document.create({
      data: { roomId: room.id, uploadedById: u.id, filename: "p.txt", storagePath: leftover, mimeType: "text/plain" },
    });
    await u.agent.post("/auth/delete-account").send({ password: PASSWORD }).expect(204);
    expect(fs.existsSync(path.join(uploadDir(), leftover))).toBe(false);
  });

  it("closes their sockets and tells the remaining members who the new admin is", async () => {
    const live = await startRealtime(app);
    try {
      const admin = await registerUser(app, newEmail("ws-admin"), "Admin");
      const stayer = await registerUser(app, newEmail("ws-stayer"), "Stayer");
      const room = await roomWith(admin, "Live handover", [stayer]);
      const adminSocket = await live.connect(admin, room.id);
      const stayerSocket = await live.connect(stayer, room.id);

      await admin.agent.post("/auth/delete-account").send({ password: PASSWORD }).expect(204);

      expect(await adminSocket.closed).toBe(4001);
      await waitFor(() =>
        stayerSocket.ofType("room:update").some((f) => (f.room as { adminId: string }).adminId === stayer.id)
      );
      const last = stayerSocket.ofType("room:update").at(-1)!.room as { participants: { userId: string }[] };
      expect(last.participants.map((p) => p.userId)).toEqual([stayer.id]);
      stayerSocket.ws.close();
    } finally {
      await live.close();
    }
  });
});
