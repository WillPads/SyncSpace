import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { canDeleteDocument } from "../lib/documentAccess.js";
import { HttpError, fieldError, hasNoNulBytes, isUuid, parseInput, parseLimit, routeParam } from "../lib/http.js";
import { type RateLimiters, limitBy } from "../lib/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";

/** The notepad is a "top 5" list: one row per slot 0..4 (UNIQUE(userId, slot) in the database). */
export const NOTEPAD_SLOTS = 5;
const MAX_QUICK_NOTE_CHARS = 5000;
const DEFAULT_FILES_LIMIT = 6;
const MAX_FILES_LIMIT = 20;

const noteSchema = z.object({
  text: z
    .string(fieldError("Note", "text"))
    .trim()
    .min(1, "A note can't be empty.")
    .max(120, "A note can be at most 120 characters.")
    .refine(hasNoNulBytes, "That note contains characters that can't be saved."),
});

const quickNoteSchema = z.object({
  text: z
    .string(fieldError("Text", "text"))
    .max(MAX_QUICK_NOTE_CHARS, `The scratch note can be at most ${MAX_QUICK_NOTE_CHARS} characters.`)
    .refine(hasNoNulBytes, "That note contains characters that can't be saved."),
});

function serializeNote(note: { id: string; body: string; createdAt: Date }) {
  return { id: note.id, text: note.body, createdAt: note.createdAt.toISOString() };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

const noteLimitReached = () =>
  new HttpError(409, "NOTE_LIMIT_REACHED", `Your notepad is full (${NOTEPAD_SLOTS} notes). Delete one to add another.`);

export function createMeRouter(limits: RateLimiters): Router {
  const router = Router();
  router.use(requireAuth);

  // ---- Private notepad: five lines, newest first ----------------------------------------

  router.get("/notes", async (req, res) => {
    const notes = await prisma.notepadItem.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    res.json({ notes: notes.map(serializeNote), limit: NOTEPAD_SLOTS });
  });

  router.post("/notes", async (req, res) => {
    const { text } = parseInput(noteSchema, req.body);
    const userId = req.user!.id;

    // Take the lowest free slot. Two requests can pick the same one at the same moment; the
    // database's UNIQUE(userId, slot) lets exactly one insert win, and the loser looks again
    // (each lost round means someone else filled a slot, so this settles within NOTEPAD_SLOTS tries).
    for (let attempt = 0; attempt <= NOTEPAD_SLOTS; attempt++) {
      const taken = new Set((await prisma.notepadItem.findMany({ where: { userId }, select: { slot: true } })).map((n) => n.slot));
      let slot = 0;
      while (taken.has(slot)) slot += 1;
      if (slot >= NOTEPAD_SLOTS) throw noteLimitReached();

      try {
        const note = await prisma.notepadItem.create({ data: { userId, slot, body: text } });
        res.status(201).json({ note: serializeNote(note) });
        return;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw noteLimitReached();
  });

  router.delete("/notes/:id", async (req, res) => {
    const id = routeParam(req, "id");
    if (!isUuid(id)) throw new HttpError(404, "NOT_FOUND", "Not found.");
    // Scoped to the owner in the same statement, so someone else's note looks exactly like a missing one.
    const { count } = await prisma.notepadItem.deleteMany({ where: { id, userId: req.user!.id } });
    if (count === 0) throw new HttpError(404, "NOT_FOUND", "Not found.");
    res.status(204).end();
  });

  // ---- Scratch note: one free-text blob, last write wins --------------------------------

  router.get("/quick-note", async (req, res) => {
    const note = await prisma.quickNote.findUnique({ where: { userId: req.user!.id } });
    res.json({ text: note?.body ?? "", updatedAt: note ? note.updatedAt.toISOString() : null });
  });

  router.put(
    "/quick-note",
    limitBy(limits.quickNotePerUser, (req) => req.user?.id ?? null, "You're saving too quickly. Wait a moment."),
    async (req, res) => {
      const { text } = parseInput(quickNoteSchema, req.body);
      const userId = req.user!.id;
      let note;
      // Two first-ever saves can race on creating the row; the loser just updates it instead.
      for (let attempt = 0; ; attempt++) {
        try {
          note = await prisma.quickNote.upsert({ where: { userId }, create: { userId, body: text }, update: { body: text } });
          break;
        } catch (err) {
          if (!isUniqueViolation(err) || attempt >= 2) throw err;
        }
      }
      res.json({ text: note.body, updatedAt: note.updatedAt.toISOString() });
    }
  );

  // ---- Dashboard "recent files": uploads from every room I'm in ------------------------

  router.get("/documents", async (req, res) => {
    const limit = parseLimit(req.query.limit, DEFAULT_FILES_LIMIT, MAX_FILES_LIMIT);
    const documents = await prisma.document.findMany({
      where: { room: { participants: { some: { userId: req.user!.id } } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      include: {
        room: { select: { name: true, participants: { where: { userId: req.user!.id }, select: { role: true } } } },
        quizzes: {
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: 1,
          select: { id: true, _count: { select: { questions: true } } },
        },
      },
    });
    res.json({
      documents: documents.map((doc) => {
        const quiz = doc.quizzes[0];
        return {
          id: doc.id,
          filename: doc.filename,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          status: doc.status,
          failureReason: doc.failureReason,
          createdAt: doc.createdAt.toISOString(),
          roomId: doc.roomId,
          roomName: doc.room.name,
          quizId: quiz?.id ?? null,
          questionCount: quiz ? quiz._count.questions : null,
          uploadedById: doc.uploadedById,
          canDelete: canDeleteDocument(req.user!.id, doc.room.participants[0]?.role ?? "", doc.uploadedById),
        };
      }),
    });
  });

  return router;
}
