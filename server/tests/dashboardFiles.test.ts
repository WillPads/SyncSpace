import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { uploadDir } from "../src/lib/documentPipeline.js";
import { cleanupUsers, registerUser, roomWith, startRealtime, waitFor } from "./helpers.js";

const suffix = randomUUID();
const emails: string[] = [];
const newEmail = (label: string) => {
  const email = `files-${label}-${suffix}@example.com`;
  emails.push(email);
  return email;
};

afterAll(() => cleanupUsers(emails));

function addDocument(roomId: string, uploadedById: string | null, extra: Partial<{ filename: string; createdAt: Date; status: "READY" | "PENDING"; storagePath: string }> = {}) {
  return prisma.document.create({
    data: {
      roomId,
      uploadedById,
      filename: extra.filename ?? "notes.txt",
      storagePath: extra.storagePath ?? `${randomUUID()}.txt`,
      mimeType: "text/plain",
      status: extra.status ?? "READY",
      sizeBytes: 123,
      createdAt: extra.createdAt,
    },
  });
}

describe("POST /rooms/:roomId/documents stores the file size", () => {
  const app = createApp();

  it("records sizeBytes from the upload and returns it", async () => {
    const u = await registerUser(app, newEmail("size"), "Size");
    const room = await roomWith(u, "Size room");
    const content = "Photosynthesis converts light energy into chemical energy. ".repeat(20);
    const res = await u.agent
      .post(`/rooms/${room.id}/documents`)
      .attach("file", Buffer.from(content), { filename: "bio.txt", contentType: "text/plain" })
      .expect(201);
    expect(res.body.document.sizeBytes).toBe(Buffer.byteLength(content));
    const row = await prisma.document.findUniqueOrThrow({ where: { id: res.body.document.id } });
    expect(row.sizeBytes).toBe(Buffer.byteLength(content));
  });
});

describe("GET /me/documents", () => {
  const app = createApp();

  it("requires a session", async () => {
    expect((await request(app).get("/me/documents")).status).toBe(401);
  });

  it("lists recent files across my rooms, newest first, with room and quiz details", async () => {
    const me = await registerUser(app, newEmail("list-me"), "Me");
    const stranger = await registerUser(app, newEmail("list-stranger"), "Stranger");
    const roomA = await roomWith(me, "Room A");
    const roomB = await roomWith(stranger, "Room B", [me]);
    const hidden = await roomWith(stranger, "Hidden");

    const base = Date.now() - 100_000;
    const oldest = await addDocument(roomA.id, me.id, { filename: "oldest.txt", createdAt: new Date(base) });
    const withQuiz = await addDocument(roomB.id, stranger.id, { filename: "quizzed.txt", createdAt: new Date(base + 1000) });
    await addDocument(hidden.id, stranger.id, { filename: "not-mine.txt", createdAt: new Date(base + 2000) });
    const failed = await prisma.document.create({
      data: {
        roomId: roomA.id,
        uploadedById: null,
        filename: "failed.pdf",
        storagePath: "x.pdf",
        mimeType: "application/pdf",
        status: "FAILED",
        failureReason: "We couldn't read this PDF.",
        createdAt: new Date(base + 3000),
      },
    });
    await prisma.quiz.create({
      data: {
        roomId: roomB.id,
        documentId: withQuiz.id,
        title: "Quiz: quizzed.txt",
        questions: {
          create: [
            { prompt: "Q1", order: 0, choices: { create: [{ text: "a", isCorrect: true }, { text: "b" }] } },
            { prompt: "Q2", order: 1, choices: { create: [{ text: "a", isCorrect: true }, { text: "b" }] } },
          ],
        },
      },
    });

    const res = await me.agent.get("/me/documents").expect(200);
    expect(res.body.documents.map((d: { id: string }) => d.id)).toEqual([failed.id, withQuiz.id, oldest.id]);
    const [failedDoc, quizzedDoc, plainDoc] = res.body.documents;
    expect(failedDoc).toEqual({
      id: failed.id,
      filename: "failed.pdf",
      mimeType: "application/pdf",
      sizeBytes: null,
      status: "FAILED",
      failureReason: "We couldn't read this PDF.",
      createdAt: expect.any(String),
      roomId: roomA.id,
      roomName: "Room A",
      quizId: null,
      questionCount: null,
      uploadedById: null,
      canDelete: true, // uploader is gone, and I'm the admin of Room A
    });
    expect(quizzedDoc).toMatchObject({ roomName: "Room B", sizeBytes: 123, quizId: expect.any(String), questionCount: 2 });
    expect(plainDoc).toMatchObject({ filename: "oldest.txt", quizId: null, questionCount: null });
  });

  it("reports uploadedById and canDelete using the same rule as the delete route", async () => {
    const admin = await registerUser(app, newEmail("cd-admin"), "Admin");
    const uploader = await registerUser(app, newEmail("cd-uploader"), "Uploader");
    const member = await registerUser(app, newEmail("cd-member"), "Member");
    const room = await roomWith(admin, "Can delete", [uploader, member]);

    const base = Date.now() - 100_000;
    const byUploader = await addDocument(room.id, uploader.id, { filename: "by-uploader.txt", createdAt: new Date(base) });
    const orphan = await addDocument(room.id, null, { filename: "orphan.txt", createdAt: new Date(base + 1000) });

    type Item = { id: string; uploadedById: string | null; canDelete: boolean };
    const view = async (u: { agent: { get: (p: string) => Promise<{ body: { documents: Item[] } }> } }) => {
      const items = (await u.agent.get("/me/documents")).body.documents;
      return {
        uploaded: items.find((d) => d.id === byUploader.id)!,
        orphan: items.find((d) => d.id === orphan.id)!,
      };
    };

    const asUploader = await view(uploader);
    expect(asUploader.uploaded).toMatchObject({ uploadedById: uploader.id, canDelete: true });
    expect(asUploader.orphan).toMatchObject({ uploadedById: null, canDelete: false });

    const asAdmin = await view(admin);
    expect(asAdmin.uploaded).toMatchObject({ uploadedById: uploader.id, canDelete: true });
    expect(asAdmin.orphan).toMatchObject({ uploadedById: null, canDelete: true });

    const asMember = await view(member);
    expect(asMember.uploaded).toMatchObject({ uploadedById: uploader.id, canDelete: false });
    expect(asMember.orphan).toMatchObject({ uploadedById: null, canDelete: false });

    // The flag must match what the DELETE route actually does.
    expect((await member.agent.delete(`/rooms/${room.id}/documents/${byUploader.id}`)).status).toBe(403);
    await uploader.agent.delete(`/rooms/${room.id}/documents/${byUploader.id}`).expect(204);
  });

  it("uses my own role in each room, not someone else's", async () => {
    const me = await registerUser(app, newEmail("role-me"), "Me");
    const other = await registerUser(app, newEmail("role-other"), "Other");
    // In room A I am the admin; in room B the other user is the admin and I am a member.
    const roomA = await roomWith(me, "Mine", [other]);
    const roomB = await roomWith(other, "Theirs", [me]);
    const inA = await addDocument(roomA.id, other.id, { filename: "in-a.txt", createdAt: new Date(Date.now() - 50_000) });
    const inB = await addDocument(roomB.id, other.id, { filename: "in-b.txt", createdAt: new Date(Date.now() - 40_000) });

    const items = (await me.agent.get("/me/documents")).body.documents as { id: string; canDelete: boolean }[];
    expect(items.find((d) => d.id === inA.id)!.canDelete).toBe(true);
    expect(items.find((d) => d.id === inB.id)!.canDelete).toBe(false);
  });

  it("defaults to 6, honours limit 1..20, and rejects anything else", async () => {
    const me = await registerUser(app, newEmail("limit"), "Limit");
    const room = await roomWith(me, "Many");
    const base = Date.now() - 1_000_000;
    for (let i = 0; i < 8; i++) await addDocument(room.id, me.id, { filename: `f${i}.txt`, createdAt: new Date(base + i * 1000) });

    const byDefault = await me.agent.get("/me/documents").expect(200);
    expect(byDefault.body.documents.map((d: { filename: string }) => d.filename)).toEqual(["f7.txt", "f6.txt", "f5.txt", "f4.txt", "f3.txt", "f2.txt"]);
    expect((await me.agent.get("/me/documents?limit=2")).body.documents).toHaveLength(2);
    expect((await me.agent.get("/me/documents?limit=20")).body.documents).toHaveLength(8);
    for (const bad of ["0", "21", "-1", "abc", "1.5", ""]) {
      const res = await me.agent.get(`/me/documents?limit=${bad}`);
      expect(res.status, `limit=${bad}`).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    }
  });

  it("stops listing a room's files once I leave it", async () => {
    const me = await registerUser(app, newEmail("leave-me"), "Leaver");
    const admin = await registerUser(app, newEmail("leave-admin"), "Admin");
    const room = await roomWith(admin, "Leave", [me]);
    await addDocument(room.id, admin.id);
    expect((await me.agent.get("/me/documents")).body.documents).toHaveLength(1);
    await me.agent.delete(`/rooms/${room.id}/participants/${me.id}`).expect(200);
    expect((await me.agent.get("/me/documents")).body.documents).toEqual([]);
  });
});

describe("DELETE /rooms/:roomId/documents/:documentId", () => {
  const app = createApp();

  async function setup(label: string) {
    const admin = await registerUser(app, newEmail(`${label}-admin`), "Admin");
    const uploader = await registerUser(app, newEmail(`${label}-uploader`), "Uploader");
    const bystander = await registerUser(app, newEmail(`${label}-bystander`), "Bystander");
    const outsider = await registerUser(app, newEmail(`${label}-outsider`), "Outsider");
    const room = await roomWith(admin, `Delete ${label}`, [uploader, bystander]);
    return { admin, uploader, bystander, outsider, room };
  }

  it("requires a session and room membership", async () => {
    const { outsider, uploader, room } = await setup("guard");
    const doc = await addDocument(room.id, uploader.id);
    expect((await request(app).delete(`/rooms/${room.id}/documents/${doc.id}`)).status).toBe(401);
    const res = await outsider.agent.delete(`/rooms/${room.id}/documents/${doc.id}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_A_MEMBER");
    expect(await prisma.document.count({ where: { id: doc.id } })).toBe(1);
  });

  it("lets only the uploader or the admin delete, and cascades the quiz and the leftover file", async () => {
    const { admin, uploader, bystander, room } = await setup("rbac");
    const leftover = `${randomUUID()}.txt`;
    fs.writeFileSync(path.join(uploadDir(), leftover), "waiting to be processed");
    const doc = await addDocument(room.id, uploader.id, { status: "PENDING", storagePath: leftover });
    const quiz = await prisma.quiz.create({ data: { roomId: room.id, documentId: doc.id, title: "Quiz" } });

    const denied = await bystander.agent.delete(`/rooms/${room.id}/documents/${doc.id}`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("FORBIDDEN");
    expect(await prisma.document.count({ where: { id: doc.id } })).toBe(1);

    await uploader.agent.delete(`/rooms/${room.id}/documents/${doc.id}`).expect(204);
    expect(await prisma.document.count({ where: { id: doc.id } })).toBe(0);
    expect(await prisma.quiz.count({ where: { id: quiz.id } })).toBe(0);
    expect(fs.existsSync(path.join(uploadDir(), leftover))).toBe(false);

    const other = await addDocument(room.id, uploader.id);
    await admin.agent.delete(`/rooms/${room.id}/documents/${other.id}`).expect(204);
  });

  it("leaves a file whose uploader is gone to the admin only", async () => {
    const { admin, bystander, room } = await setup("orphan");
    const doc = await addDocument(room.id, null);
    expect((await bystander.agent.delete(`/rooms/${room.id}/documents/${doc.id}`)).status).toBe(403);
    await admin.agent.delete(`/rooms/${room.id}/documents/${doc.id}`).expect(204);
  });

  it("answers 404 for unknown ids, repeats, and documents from another room", async () => {
    const { admin, uploader, room } = await setup("missing");
    const otherRoom = await roomWith(admin, "Elsewhere");
    const elsewhere = await addDocument(otherRoom.id, admin.id);
    expect((await admin.agent.delete(`/rooms/${room.id}/documents/${randomUUID()}`)).status).toBe(404);
    expect((await admin.agent.delete(`/rooms/${room.id}/documents/not-a-uuid`)).status).toBe(404);
    const crossRoom = await admin.agent.delete(`/rooms/${room.id}/documents/${elsewhere.id}`);
    expect(crossRoom.status).toBe(404);
    expect(crossRoom.body.code).toBe("DOCUMENT_NOT_FOUND");
    expect(await prisma.document.count({ where: { id: elsewhere.id } })).toBe(1);

    const doc = await addDocument(room.id, uploader.id);
    await uploader.agent.delete(`/rooms/${room.id}/documents/${doc.id}`).expect(204);
    await uploader.agent.delete(`/rooms/${room.id}/documents/${doc.id}`).expect(404);
  });

  it("broadcasts document:deleted to everyone in the room", async () => {
    const live = await startRealtime(app);
    try {
      const { uploader, bystander, room } = await setup("ws");
      const doc = await addDocument(room.id, uploader.id);
      const watcher = await live.connect(bystander, room.id);
      const self = await live.connect(uploader, room.id);

      await uploader.agent.delete(`/rooms/${room.id}/documents/${doc.id}`).expect(204);
      await waitFor(() => watcher.ofType("document:deleted").length > 0 && self.ofType("document:deleted").length > 0);
      expect(watcher.ofType("document:deleted")[0]).toEqual({ type: "document:deleted", documentId: doc.id });
      watcher.ws.close();
      self.ws.close();
    } finally {
      await live.close();
    }
  });
});
