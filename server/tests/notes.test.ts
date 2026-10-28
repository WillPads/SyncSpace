import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { cleanupUsers, registerUser, wait } from "./helpers.js";

const suffix = randomUUID();
const emails: string[] = [];
const newEmail = (label: string) => {
  const email = `notes-${label}-${suffix}@example.com`;
  emails.push(email);
  return email;
};

afterAll(() => cleanupUsers(emails));

describe("private notepad (/me/notes)", () => {
  const app = createApp();

  it("requires a session on every route", async () => {
    expect((await request(app).get("/me/notes")).status).toBe(401);
    expect((await request(app).post("/me/notes").send({ text: "x" })).status).toBe(401);
    expect((await request(app).delete(`/me/notes/${randomUUID()}`)).status).toBe(401);
  });

  it("starts empty and reports the limit", async () => {
    const u = await registerUser(app, newEmail("empty"), "Empty");
    const res = await u.agent.get("/me/notes").expect(200);
    expect(res.body).toEqual({ notes: [], limit: 5 });
  });

  it("validates the text", async () => {
    const u = await registerUser(app, newEmail("validate"), "Validate");
    for (const body of [{}, { text: "" }, { text: "   " }, { text: "x".repeat(121) }, { text: 5 }, { text: "a\u0000b" }]) {
      const res = await u.agent.post("/me/notes").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    }
    const ok = await u.agent.post("/me/notes").send({ text: `  ${"x".repeat(120)}  ` }).expect(201);
    expect(ok.body.note.text).toHaveLength(120);
  });

  it("returns notes newest first, refuses a 6th with 409, and frees a slot on delete", async () => {
    const u = await registerUser(app, newEmail("limit"), "Limit");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await u.agent.post("/me/notes").send({ text: `note ${i}` }).expect(201);
      expect(res.body.note).toEqual({ id: expect.any(String), text: `note ${i}`, createdAt: expect.any(String) });
      ids.push(res.body.note.id);
      await wait(5);
    }
    const sixth = await u.agent.post("/me/notes").send({ text: "one too many" });
    expect(sixth.status).toBe(409);
    expect(sixth.body.code).toBe("NOTE_LIMIT_REACHED");

    const list = await u.agent.get("/me/notes").expect(200);
    expect(list.body.notes.map((n: { text: string }) => n.text)).toEqual(["note 4", "note 3", "note 2", "note 1", "note 0"]);

    await u.agent.delete(`/me/notes/${ids[2]}`).expect(204);
    // The lowest free slot is reused, so the table never needs more than slots 0..4.
    const again = await u.agent.post("/me/notes").send({ text: "replacement" }).expect(201);
    const slots = (await prisma.notepadItem.findMany({ where: { userId: u.id }, select: { slot: true } })).map((n) => n.slot);
    expect(slots.sort()).toEqual([0, 1, 2, 3, 4]);
    expect((await u.agent.get("/me/notes")).body.notes[0].id).toBe(again.body.note.id);
  });

  it("never lets simultaneous inserts go past 5", async () => {
    const u = await registerUser(app, newEmail("race"), "Race");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => u.agent.post("/me/notes").send({ text: `racer ${i}` }))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === "NOTE_LIMIT_REACHED")).toBe(true);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const rows = await prisma.notepadItem.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.slot)).size).toBe(5);
  });

  it("keeps notes private: others see none, can't delete them, and have their own five", async () => {
    const owner = await registerUser(app, newEmail("owner"), "Owner");
    const other = await registerUser(app, newEmail("other"), "Other");
    const note = (await owner.agent.post("/me/notes").send({ text: "secret" }).expect(201)).body.note;

    expect((await other.agent.get("/me/notes")).body.notes).toEqual([]);
    const stolen = await other.agent.delete(`/me/notes/${note.id}`);
    expect(stolen.status).toBe(404);
    expect(stolen.body.code).toBe("NOT_FOUND");
    expect((await owner.agent.get("/me/notes")).body.notes).toHaveLength(1);

    expect((await owner.agent.delete(`/me/notes/${randomUUID()}`)).status).toBe(404);
    expect((await owner.agent.delete("/me/notes/not-a-uuid")).status).toBe(404);
    for (let i = 0; i < 5; i++) await other.agent.post("/me/notes").send({ text: `mine ${i}` }).expect(201);

    await owner.agent.delete(`/me/notes/${note.id}`).expect(204);
    await owner.agent.delete(`/me/notes/${note.id}`).expect(404);
  });
});

describe("scratch note (/me/quick-note)", () => {
  const app = createApp();

  it("requires a session", async () => {
    expect((await request(app).get("/me/quick-note")).status).toBe(401);
    expect((await request(app).put("/me/quick-note").send({ text: "x" })).status).toBe(401);
  });

  it("is empty before the first save, then last write wins", async () => {
    const u = await registerUser(app, newEmail("qn"), "Quick");
    expect((await u.agent.get("/me/quick-note").expect(200)).body).toEqual({ text: "", updatedAt: null });

    const first = await u.agent.put("/me/quick-note").send({ text: "first draft" }).expect(200);
    expect(first.body).toEqual({ text: "first draft", updatedAt: expect.any(String) });
    await wait(5);
    const second = await u.agent.put("/me/quick-note").send({ text: "  second\n draft  " }).expect(200);
    expect(second.body.text).toBe("  second\n draft  "); // stored exactly as typed
    expect(Date.parse(second.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(first.body.updatedAt));

    expect((await u.agent.get("/me/quick-note")).body).toEqual(second.body);
    expect((await u.agent.put("/me/quick-note").send({ text: "" }).expect(200)).body.text).toBe("");
    expect(await prisma.quickNote.count({ where: { userId: u.id } })).toBe(1);
  });

  it("accepts exactly 5000 characters and rejects more or the wrong type", async () => {
    const u = await registerUser(app, newEmail("qn-size"), "Size");
    await u.agent.put("/me/quick-note").send({ text: "a".repeat(5000) }).expect(200);
    for (const body of [{ text: "a".repeat(5001) }, {}, { text: 12 }, { text: "x\u0000y" }]) {
      expect((await u.agent.put("/me/quick-note").send(body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
  });

  it("survives simultaneous first saves and is private per user", async () => {
    const a = await registerUser(app, newEmail("qn-a"), "A");
    const b = await registerUser(app, newEmail("qn-b"), "B");
    const results = await Promise.all(["one", "two", "three", "four"].map((text) => a.agent.put("/me/quick-note").send({ text })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.quickNote.count({ where: { userId: a.id } })).toBe(1);
    expect((await b.agent.get("/me/quick-note")).body).toEqual({ text: "", updatedAt: null });
  });

  it("limits autosaves per minute", async () => {
    const limited = createApp({ rateLimits: { quickNotePerUser: { windowMs: 60_000, max: 3 } } });
    const u = await registerUser(limited, newEmail("qn-rl"), "Limited");
    for (let i = 0; i < 3; i++) await u.agent.put("/me/quick-note").send({ text: `v${i}` }).expect(200);
    const res = await u.agent.put("/me/quick-note").send({ text: "v3" });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
    // Reading is never limited.
    await u.agent.get("/me/quick-note").expect(200);
  });
});
