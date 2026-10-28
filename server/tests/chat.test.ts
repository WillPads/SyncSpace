import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { cleanupUsers, registerUser, roomWith, startRealtime, waitFor } from "./helpers.js";

const suffix = randomUUID();
const emails: string[] = [];
const newEmail = (label: string) => {
  const email = `chat-${label}-${suffix}@example.com`;
  emails.push(email);
  return email;
};

afterAll(() => cleanupUsers(emails));

type Wire = { id: string; userId: string | null; displayName: string; body: string; createdAt: string };

describe("room chat", () => {
  const app = createApp();

  async function setup(label: string) {
    const admin = await registerUser(app, newEmail(`${label}-admin`), "Admin");
    const member = await registerUser(app, newEmail(`${label}-member`), "Member");
    const outsider = await registerUser(app, newEmail(`${label}-outsider`), "Outsider");
    const room = await roomWith(admin, `Chat ${label}`, [member]);
    return { admin, member, outsider, room };
  }

  it("requires a session and room membership", async () => {
    const { outsider, admin, room } = await setup("guard");
    const message = (await admin.agent.post(`/rooms/${room.id}/messages`).send({ body: "hi" }).expect(201)).body.message;

    expect((await request(app).get(`/rooms/${room.id}/messages`)).status).toBe(401);
    expect((await request(app).post(`/rooms/${room.id}/messages`).send({ body: "x" })).status).toBe(401);
    expect((await request(app).delete(`/rooms/${room.id}/messages/${message.id}`)).status).toBe(401);

    for (const call of [
      () => outsider.agent.get(`/rooms/${room.id}/messages`),
      () => outsider.agent.post(`/rooms/${room.id}/messages`).send({ body: "let me in" }),
      () => outsider.agent.delete(`/rooms/${room.id}/messages/${message.id}`),
    ]) {
      const res = await call();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("NOT_A_MEMBER");
    }
    expect(await prisma.chatMessage.count({ where: { roomId: room.id } })).toBe(1);
  });

  it("validates the body and trims it", async () => {
    const { member, room } = await setup("validate");
    for (const body of [{}, { body: "" }, { body: "   \n " }, { body: "x".repeat(501) }, { body: 7 }, { body: "a\u0000b" }]) {
      const res = await member.agent.post(`/rooms/${room.id}/messages`).send(body);
      expect(res.status, JSON.stringify(body).slice(0, 30)).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    }
    const ok = await member.agent.post(`/rooms/${room.id}/messages`).send({ body: `  ${"y".repeat(500)}  ` }).expect(201);
    expect(ok.body.message.body).toHaveLength(500);
  });

  it("posts a message and returns it in the wire shape", async () => {
    const { member, room } = await setup("post");
    const res = await member.agent.post(`/rooms/${room.id}/messages`).send({ body: "  hello room  " }).expect(201);
    expect(res.body).toEqual({
      message: { id: expect.any(String), userId: member.id, displayName: "Member", body: "hello room", createdAt: expect.any(String) },
    });
    const list = await member.agent.get(`/rooms/${room.id}/messages`).expect(200);
    expect(list.body).toEqual({ messages: [res.body.message], nextBefore: null });
  });

  it("returns pages oldest-first and walks back through identical timestamps without gaps or repeats", async () => {
    const { member, room } = await setup("pages");
    const sameInstant = new Date(Date.now() - 60_000);
    const earlier = new Date(sameInstant.getTime() - 5000);
    // 110 messages: 10 older, 100 sharing one createdAt. The id is the only thing that orders those.
    await prisma.chatMessage.createMany({
      data: [
        ...Array.from({ length: 10 }, (_, i) => ({ roomId: room.id, authorId: member.id, body: `old ${i}`, createdAt: new Date(earlier.getTime() + i) })),
        ...Array.from({ length: 100 }, (_, i) => ({ roomId: room.id, authorId: member.id, body: `tie ${i}`, createdAt: sameInstant })),
      ],
    });
    const expected = (await prisma.chatMessage.findMany({ where: { roomId: room.id } }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      .map((m) => m.id);

    const first = await member.agent.get(`/rooms/${room.id}/messages?limit=40`).expect(200);
    expect(first.body.messages).toHaveLength(40);
    expect(first.body.nextBefore).toBe(first.body.messages[0].id); // the oldest message in the page

    const collected: string[][] = [first.body.messages.map((m: Wire) => m.id)];
    let cursor: string | null = first.body.nextBefore;
    let pages = 1;
    while (cursor) {
      const page = await member.agent.get(`/rooms/${room.id}/messages?limit=40&before=${cursor}`).expect(200);
      collected.unshift(page.body.messages.map((m: Wire) => m.id));
      cursor = page.body.nextBefore;
      pages += 1;
    }
    expect(pages).toBe(3); // 40 + 40 + 30
    expect(collected.flat()).toEqual(expected);

    // Without a limit the default page is the newest 50.
    const byDefault = await member.agent.get(`/rooms/${room.id}/messages`).expect(200);
    expect(byDefault.body.messages.map((m: Wire) => m.id)).toEqual(expected.slice(-50));
    expect(byDefault.body.nextBefore).not.toBeNull();
    // A page that reaches the start has no cursor, even when it's exactly full.
    const all = await member.agent.get(`/rooms/${room.id}/messages?limit=100&before=${expected[100]}`).expect(200);
    expect(all.body.messages).toHaveLength(100);
    expect(all.body.nextBefore).toBeNull();
  });

  it("rejects bad limits and cursors with 400", async () => {
    const { admin, member, room } = await setup("cursor");
    const other = await roomWith(admin, "Other room");
    const foreign = (await admin.agent.post(`/rooms/${other.id}/messages`).send({ body: "elsewhere" }).expect(201)).body.message;
    for (const query of ["limit=0", "limit=101", "limit=abc", `before=${randomUUID()}`, "before=not-a-uuid", `before=${foreign.id}`, "before="]) {
      const res = await member.agent.get(`/rooms/${room.id}/messages?${query}`);
      expect(res.status, query).toBe(400);
    }
    expect((await member.agent.get(`/rooms/${room.id}/messages?before=${randomUUID()}`)).body.code).toBe("INVALID_CURSOR");
    expect((await member.agent.get(`/rooms/${room.id}/messages?limit=100`)).status).toBe(200);
    expect((await member.agent.get(`/rooms/${room.id}/messages?limit=1`)).status).toBe(200);
  });

  it("shows a deleted author as 'Deleted user' with a null userId", async () => {
    const { member, room } = await setup("ghost");
    await prisma.chatMessage.create({ data: { roomId: room.id, authorId: null, body: "from a ghost" } });
    const res = await member.agent.get(`/rooms/${room.id}/messages`).expect(200);
    expect(res.body.messages[0]).toMatchObject({ userId: null, displayName: "Deleted user", body: "from a ghost" });
  });

  it("keeps only the newest 500 messages per room", async () => {
    const { member, room } = await setup("prune");
    const other = await roomWith(member, "Untouched");
    const start = Date.now() - 1_000_000;
    await prisma.chatMessage.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({ roomId: room.id, authorId: member.id, body: `m${i}`, createdAt: new Date(start + i) })),
    });
    await prisma.chatMessage.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({ roomId: other.id, authorId: member.id, body: `o${i}` })),
    });

    await member.agent.post(`/rooms/${room.id}/messages`).send({ body: "the 501st" }).expect(201);
    const kept = await prisma.chatMessage.findMany({ where: { roomId: room.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(kept).toHaveLength(500);
    expect(kept[0].body).toBe("m1"); // m0 was the oldest and went
    expect(kept.at(-1)!.body).toBe("the 501st");
    expect(await prisma.chatMessage.count({ where: { roomId: other.id } })).toBe(3);
  });

  it("lets the author or the admin delete a message, and nobody else", async () => {
    const { admin, member, room } = await setup("delete");
    const third = await registerUser(app, newEmail("delete-third"), "Third");
    await third.agent.post(`/rooms/${room.code}/join`).send({}).expect(201);

    const post = async (user: typeof member, body: string) =>
      (await user.agent.post(`/rooms/${room.id}/messages`).send({ body }).expect(201)).body.message as Wire;
    const mine = await post(member, "mine");
    const adminsOwn = await post(admin, "admin's");
    const orphan = await prisma.chatMessage.create({ data: { roomId: room.id, authorId: null, body: "orphan" } });

    const denied = await third.agent.delete(`/rooms/${room.id}/messages/${mine.id}`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("FORBIDDEN");
    expect((await member.agent.delete(`/rooms/${room.id}/messages/${adminsOwn.id}`)).status).toBe(403);
    expect((await member.agent.delete(`/rooms/${room.id}/messages/${orphan.id}`)).status).toBe(403);

    await member.agent.delete(`/rooms/${room.id}/messages/${mine.id}`).expect(204); // author
    await admin.agent.delete(`/rooms/${room.id}/messages/${orphan.id}`).expect(204); // admin, author gone
    const memberText = await post(member, "removed by admin");
    await admin.agent.delete(`/rooms/${room.id}/messages/${memberText.id}`).expect(204); // admin, someone else's
    await member.agent.delete(`/rooms/${room.id}/messages/${mine.id}`).expect(404); // already gone
    expect((await prisma.chatMessage.findMany({ where: { roomId: room.id } })).map((m) => m.body)).toEqual(["admin's"]);
  });

  it("answers 404 for ids that don't exist or belong to another room", async () => {
    const { admin, room } = await setup("missing");
    const other = await roomWith(admin, "Other");
    const foreign = (await admin.agent.post(`/rooms/${other.id}/messages`).send({ body: "elsewhere" }).expect(201)).body.message;
    expect((await admin.agent.delete(`/rooms/${room.id}/messages/${randomUUID()}`)).status).toBe(404);
    expect((await admin.agent.delete(`/rooms/${room.id}/messages/not-a-uuid`)).status).toBe(404);
    const cross = await admin.agent.delete(`/rooms/${room.id}/messages/${foreign.id}`);
    expect(cross.status).toBe(404);
    expect(cross.body.code).toBe("MESSAGE_NOT_FOUND");
    expect(await prisma.chatMessage.count({ where: { id: foreign.id } })).toBe(1);
  });

  it("limits how fast one person can send", async () => {
    const limited = createApp({ rateLimits: { chatPerUser: { windowMs: 60_000, max: 3 } } });
    const admin = await registerUser(limited, newEmail("rl-admin"), "Admin");
    const room = await roomWith(admin, "Limited");
    for (let i = 0; i < 3; i++) await admin.agent.post(`/rooms/${room.id}/messages`).send({ body: `m${i}` }).expect(201);
    const res = await admin.agent.post(`/rooms/${room.id}/messages`).send({ body: "too fast" });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    await admin.agent.get(`/rooms/${room.id}/messages`).expect(200);
  });

  it("pushes chat:message to everyone in the room (sender included) and chat:deleted on removal", async () => {
    const live = await startRealtime(app);
    try {
      const { admin, member, outsider, room } = await setup("ws");
      const otherRoom = await roomWith(outsider, "Elsewhere");
      const adminSocket = await live.connect(admin, room.id);
      const memberSocket = await live.connect(member, room.id);
      const bystander = await live.connect(outsider, otherRoom.id);

      const sent = (await member.agent.post(`/rooms/${room.id}/messages`).send({ body: "live!" }).expect(201)).body.message as Wire;
      await waitFor(() => adminSocket.ofType("chat:message").length > 0 && memberSocket.ofType("chat:message").length > 0);
      expect(adminSocket.ofType("chat:message")).toEqual([{ type: "chat:message", message: sent }]);
      expect(memberSocket.ofType("chat:message")).toEqual([{ type: "chat:message", message: sent }]);

      await admin.agent.delete(`/rooms/${room.id}/messages/${sent.id}`).expect(204);
      await waitFor(() => adminSocket.ofType("chat:deleted").length > 0 && memberSocket.ofType("chat:deleted").length > 0);
      expect(memberSocket.ofType("chat:deleted")).toEqual([{ type: "chat:deleted", messageId: sent.id }]);

      expect(bystander.ofType("chat:message")).toHaveLength(0);
      expect(bystander.ofType("chat:deleted")).toHaveLength(0);
      for (const client of [adminSocket, memberSocket, bystander]) client.ws.close();
    } finally {
      await live.close();
    }
  });
});
