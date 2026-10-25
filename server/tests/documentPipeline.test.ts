import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import {
  checkUploadContent,
  generateQuestions,
  processDocument,
  sanitizeText,
  uploadDir,
} from "../src/lib/documentPipeline.js";
import type { LlmQuizGenerator } from "../src/lib/llmQuiz.js";

const NOTES = `Photosynthesis converts light energy into chemical energy stored in glucose molecules.
Chlorophyll pigments inside chloroplasts absorb mostly red and blue wavelengths of light.
The Calvin cycle fixes atmospheric carbon dioxide using the enzyme called rubisco.
Oxygen released during photosynthesis comes from splitting water molecules in photosystem two.
Cellular respiration later breaks glucose down again to release usable energy for the cell.`;

/** A real, minimal one-page PDF with a single line of text (offsets computed, so it's valid). */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/([\\()])/g, "\\$1")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const llmReturning = (result: Awaited<ReturnType<LlmQuizGenerator["generate"]>>): LlmQuizGenerator => ({
  generate: async () => result,
});

describe("sanitizeText", () => {
  it("removes what Postgres can't store and normalizes line endings", () => {
    expect(sanitizeText("﻿a\u0000b\r\nc\rd\u0007e\tf")).toBe("ab\nc\nde\tf");
  });
});

describe("checkUploadContent", () => {
  const dir = path.join(uploadDir(), `check-${randomUUID()}`);
  const write = (name: string, data: Buffer | string) => {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, data);
    return file;
  };

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("requires the PDF signature for PDFs", async () => {
    expect(await checkUploadContent(write("real.pdf", minimalPdf("Hi")), "pdf")).toBeNull();
    expect(await checkUploadContent(write("fake.pdf", "just text"), "pdf")).toBe("That file isn't a valid PDF.");
  });

  it("rejects binary data posing as text, but accepts UTF-16 text", async () => {
    expect(await checkUploadContent(write("bin.txt", Buffer.from([0x48, 0x00, 0x49])), "text")).toMatch(/plain text/);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Hello", "utf16le")]);
    expect(await checkUploadContent(write("utf16.txt", utf16), "text")).toBeNull();
    expect(await checkUploadContent(write("empty.txt", ""), "text")).toBe("That file is empty.");
  });
});

describe("generateQuestions", () => {
  const llmQuestion = { prompt: "Which pigment absorbs light?", correctAnswer: "Chlorophyll", choices: ["Rubisco", "Chlorophyll", "Glucose", "Water"] };

  it("uses Claude's questions when the call succeeds", async () => {
    const result = await generateQuestions(NOTES, "bio.txt", llmReturning({ ok: true, questions: [llmQuestion], model: "m" }));
    expect(result).toEqual({ questions: [llmQuestion], generatedBy: "LLM" });
  });

  it("falls back to the built-in generator when Claude fails", async () => {
    const result = await generateQuestions(NOTES, "bio.txt", llmReturning({ ok: false, reason: "rate limited (429)" }));
    expect(result.generatedBy).toBe("HEURISTIC");
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it("respects Claude judging the notes too thin for a quiz", async () => {
    const result = await generateQuestions(NOTES, "bio.txt", llmReturning({ ok: true, questions: [], model: "m" }));
    expect(result).toEqual({ questions: [], generatedBy: "LLM" });
  });

  it("uses the built-in generator when Claude isn't configured", async () => {
    expect((await generateQuestions(NOTES, "bio.txt", null)).generatedBy).toBe("HEURISTIC");
  });
});

describe("processDocument", () => {
  const suffix = randomUUID();
  const email = `pipeline-${suffix}@example.com`;
  let roomId = "";
  let userId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email, passwordHash: "x", displayName: "Pipeline" } });
    userId = user.id;
    const room = await prisma.room.create({ data: { code: suffix.slice(0, 5).toUpperCase(), name: "Pipeline", adminId: userId } });
    roomId = room.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  async function documentFor(data: Buffer | string, ext: string, mimeType: string, write = true) {
    const storagePath = `${randomUUID()}${ext}`;
    if (write) fs.writeFileSync(path.join(uploadDir(), storagePath), data);
    return prisma.document.create({
      data: { roomId, uploadedById: userId, filename: `notes${ext}`, storagePath, mimeType },
    });
  }

  it("stores Claude's quiz with exactly one correct choice per question, then marks the document ready", async () => {
    const question = { prompt: "Which pigment absorbs light?", correctAnswer: "Chlorophyll", choices: ["Rubisco", "Chlorophyll", "Glucose", "Water"] };
    const document = await documentFor(NOTES, ".txt", "text/plain");
    await processDocument(document.id, { llm: llmReturning({ ok: true, questions: [question], model: "m" }) });

    const saved = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(saved.status).toBe("READY");
    expect(saved.parsedText).toBe(NOTES);
    expect(fs.existsSync(path.join(uploadDir(), document.storagePath))).toBe(false);

    const quiz = await prisma.quiz.findFirstOrThrow({
      where: { documentId: document.id },
      include: { questions: { include: { choices: { orderBy: { order: "asc" } } } } },
    });
    expect(quiz.generatedBy).toBe("LLM");
    const choices = quiz.questions[0].choices;
    expect(choices.map((c) => c.text)).toEqual(question.choices);
    expect(choices.filter((c) => c.isCorrect).map((c) => c.text)).toEqual(["Chlorophyll"]);
  });

  it("falls back to the built-in generator when Claude fails", async () => {
    const document = await documentFor(NOTES, ".txt", "text/plain");
    await processDocument(document.id, { llm: llmReturning({ ok: false, reason: "the request timed out" }) });
    const quiz = await prisma.quiz.findFirstOrThrow({ where: { documentId: document.id } });
    expect(quiz.generatedBy).toBe("HEURISTIC");
  });

  it("marks the document ready without a quiz when there's nothing to quiz on", async () => {
    const document = await documentFor(NOTES, ".txt", "text/plain");
    await processDocument(document.id, { llm: llmReturning({ ok: true, questions: [], model: "m" }) });
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).status).toBe("READY");
    expect(await prisma.quiz.count({ where: { documentId: document.id } })).toBe(0);
  });

  it("extracts text from a PDF", async () => {
    const document = await documentFor(minimalPdf("Mitochondria are the powerhouse of the cell."), ".pdf", "application/pdf");
    await processDocument(document.id, { llm: null });
    const saved = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(saved.status).toBe("READY");
    expect(saved.parsedText).toContain("Mitochondria are the powerhouse of the cell.");
  });

  it("extracts every PDF correctly when one process handles several in a row", async () => {
    // pdf-parse 1.x returned empty text for every PDF after the first in a process.
    const lines = ["Alpha particles are helium nuclei.", "Beta decay emits an electron.", "Gamma rays are photons."];
    for (const line of lines) {
      const document = await documentFor(minimalPdf(line), ".pdf", "application/pdf");
      await processDocument(document.id, { llm: null });
      const saved = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
      expect(saved.parsedText?.trim()).toBe(line);
    }
  });

  it("decodes UTF-16 text files", async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(NOTES, "utf16le")]);
    const document = await documentFor(utf16, ".txt", "text/plain");
    await processDocument(document.id, { llm: null });
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).parsedText).toBe(NOTES);
  });

  it("fails a damaged PDF with a reason the user can act on", async () => {
    const document = await documentFor("%PDF-1.4\nthis is not really a pdf", ".pdf", "application/pdf");
    await processDocument(document.id, { llm: null });
    const saved = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(saved.status).toBe("FAILED");
    expect(saved.failureReason).toMatch(/couldn't read this PDF/);
  });

  it("fails a document whose upload was lost in a restart", async () => {
    const document = await documentFor("", ".txt", "text/plain", false);
    await processDocument(document.id, { llm: null });
    const saved = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(saved.status).toBe("FAILED");
    expect(saved.failureReason).toMatch(/server restarted/);
  });

  it("fails a file with no text in it", async () => {
    const document = await documentFor(" \n\t \n", ".txt", "text/plain");
    await processDocument(document.id, { llm: null });
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).failureReason).toMatch(/any text/);
  });
});

describe("POST /rooms/:roomId/documents", () => {
  const suffix = randomUUID();
  const email = `upload-${suffix}@example.com`;
  const app = createApp();
  const agent = request.agent(app);
  let roomId = "";

  beforeAll(async () => {
    await agent.post("/auth/register").send({ email, password: "correct-horse-battery-staple", displayName: "Uploader" });
    roomId = (await agent.post("/rooms").send({ name: "Uploads" })).body.room.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  const upload = (data: Buffer | string, filename: string, contentType = "application/octet-stream") =>
    agent.post(`/rooms/${roomId}/documents`).attach("file", Buffer.from(data), { filename, contentType });

  it("checks the bytes, not just the name", async () => {
    const fakePdf = await upload("plain text in disguise", "notes.pdf", "application/pdf");
    expect(fakePdf.status).toBe(400);
    expect(fakePdf.body.code).toBe("INVALID_FILE");

    const binary = await upload(Buffer.from([0x00, 0x01, 0x02, 0x03]), "notes.txt", "text/plain");
    expect(binary.status).toBe(400);
  });

  it("rejects files over 4 MB with 413", async () => {
    const res = await upload(Buffer.alloc(4 * 1024 * 1024 + 1, 0x61), "big.txt", "text/plain");
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("FILE_TOO_LARGE");
  });

  it("requires a file", async () => {
    const res = await agent.post(`/rooms/${roomId}/documents`).field("note", "no file here");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_FILE");
  });

  it("keeps non-ASCII file names intact and types the file by its extension", async () => {
    const res = await upload(NOTES, "résumé notes.md", "application/octet-stream");
    expect(res.status).toBe(201);
    expect(res.body.document).toMatchObject({ filename: "résumé notes.md", mimeType: "text/markdown", status: "PENDING" });
  });
});
