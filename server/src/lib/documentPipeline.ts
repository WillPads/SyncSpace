import fs from "node:fs";
import path from "node:path";
import type { Document, QuizGenerator } from "@prisma/client";
import { getDocumentProxy } from "unpdf";
import { getConfig } from "../config.js";
import { prisma } from "../db.js";
import type { DocumentUpdate } from "../ws/protocol.js";
import { sendToRoom } from "../ws/registry.js";
import { type LlmQuizGenerator, llmQuizGeneratorFromEnv } from "./llmQuiz.js";
import { enqueue } from "./pipelineQueue.js";
import { type GeneratedQuestion, generateQuiz } from "./quizgen.js";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_STORED_TEXT_CHARS = 300_000;
const SNIFF_BYTES = 8192;

let resolvedUploadDir: string | undefined;

export function uploadDir(): string {
  if (!resolvedUploadDir) {
    resolvedUploadDir = path.resolve(getConfig().uploadDir ?? path.join(process.cwd(), "uploads"));
    fs.mkdirSync(resolvedUploadDir, { recursive: true });
  }
  return resolvedUploadDir;
}

function uploadPath(storagePath: string): string {
  // storagePath is always a name we generated, but never let it point outside the folder.
  return path.join(uploadDir(), path.basename(storagePath));
}

export async function removeUploads(storagePaths: string[]): Promise<void> {
  await Promise.all(storagePaths.map((name) => fs.promises.rm(uploadPath(name), { force: true }).catch(() => {})));
}

type TextEncoding = "utf-8" | "utf-16le" | "utf-16be";

function detectEncoding(head: Buffer): TextEncoding {
  if (head[0] === 0xff && head[1] === 0xfe) return "utf-16le";
  if (head[0] === 0xfe && head[1] === 0xff) return "utf-16be";
  return "utf-8";
}

/**
 * Checks an upload's actual bytes rather than trusting its name or the browser's MIME type.
 * Returns a message for the user when the file is unusable.
 */
export async function checkUploadContent(fullPath: string, kind: "pdf" | "text"): Promise<string | null> {
  const handle = await fs.promises.open(fullPath, "r");
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(SNIFF_BYTES), 0, SNIFF_BYTES, 0);
    const head = buffer.subarray(0, bytesRead);
    if (bytesRead === 0) return "That file is empty.";
    if (kind === "pdf") {
      const marker = head.indexOf("%PDF-");
      return marker !== -1 && marker < 1024 ? null : "That file isn't a valid PDF.";
    }
    // NUL bytes mean binary data - unless it's UTF-16 text, which Windows tools often produce.
    if (detectEncoding(head) === "utf-8" && head.includes(0)) return "That file doesn't look like plain text.";
    return null;
  } finally {
    await handle.close();
  }
}

/** Makes extracted text safe to store: Postgres rejects NUL bytes, and other control characters are noise. */
export function sanitizeText(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, MAX_STORED_TEXT_CHARS);
}

/**
 * Text from the first MAX_PDF_PAGES pages, via Mozilla's PDF.js (unpdf bundles its
 * serverless build, which contains no eval/new Function paths). Pages are read one at a
 * time so a huge PDF can't balloon memory.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PDF_PAGES); pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("")
      );
      page.cleanup();
    }
    return pages.join("\n\n");
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function extractText(document: Pick<Document, "storagePath" | "mimeType">): Promise<string> {
  const buffer = await fs.promises.readFile(uploadPath(document.storagePath));
  if (document.mimeType === "application/pdf") return extractPdfText(buffer);
  return new TextDecoder(detectEncoding(buffer)).decode(buffer);
}

const FAILURE = {
  lost: "The upload was lost before it could be processed (the server restarted). Upload it again.",
  unreadablePdf: "We couldn't read this PDF. It may be encrypted or damaged.",
  noText: "We couldn't find any text in this file. Scanned PDFs (pictures of text) aren't supported.",
  unexpected: "Something went wrong while processing this file. Try uploading it again.",
} as const;

function describeExtractionError(err: unknown, mimeType: string): string {
  if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT") return FAILURE.lost;
  return mimeType === "application/pdf" ? FAILURE.unreadablePdf : FAILURE.unexpected;
}

function emitDocumentUpdate(document: Pick<Document, "id" | "roomId" | "filename">, update: Omit<DocumentUpdate, "id" | "filename">) {
  sendToRoom(document.roomId, {
    type: "document:update",
    document: { id: document.id, filename: document.filename, ...update },
  });
}

/** Moves a document to FAILED. Returns false if the document no longer exists. */
async function failDocument(document: Document, reason: string): Promise<boolean> {
  const { count } = await prisma.document.updateMany({
    where: { id: document.id },
    data: { status: "FAILED", failureReason: reason },
  });
  if (count > 0) emitDocumentUpdate(document, { status: "FAILED", failureReason: reason });
  return count > 0;
}

export interface PipelineDeps {
  /** Claude-backed generator, or null to always use the built-in one. */
  llm: LlmQuizGenerator | null;
}

let defaultLlm: LlmQuizGenerator | null | undefined;

function defaultDeps(): PipelineDeps {
  if (defaultLlm === undefined) defaultLlm = llmQuizGeneratorFromEnv(getConfig());
  return { llm: defaultLlm };
}

/** Claude first when configured; the built-in generator when it isn't, or when Claude fails. */
export async function generateQuestions(
  text: string,
  filename: string,
  llm: LlmQuizGenerator | null
): Promise<{ questions: GeneratedQuestion[]; generatedBy: QuizGenerator }> {
  if (llm) {
    const result = await llm.generate(text, filename);
    // An empty, successful answer means Claude judged the notes too thin for a fair quiz.
    if (result.ok) return { questions: result.questions, generatedBy: "LLM" };
    console.warn(`Claude quiz generation failed for "${filename}" (${result.reason}); using the built-in generator.`);
  }
  return { questions: generateQuiz(text), generatedBy: "HEURISTIC" };
}

/**
 * PENDING -> PARSING -> READY (with a quiz, if one could be made) or FAILED (with a reason).
 * READY is only set once the quiz is saved, in the same transaction, so a READY document
 * never has a quiz still on the way. Every transition is pushed as `document:update`.
 */
export async function processDocument(documentId: string, deps: PipelineDeps = defaultDeps()): Promise<void> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document || document.status === "READY" || document.status === "FAILED") return;

  try {
    const { count } = await prisma.document.updateMany({ where: { id: documentId }, data: { status: "PARSING" } });
    if (count === 0) return;
    emitDocumentUpdate(document, { status: "PARSING", failureReason: null });

    let text: string;
    try {
      text = sanitizeText(await extractText(document));
    } catch (err) {
      console.warn(`Couldn't extract text from document ${documentId}:`, err instanceof Error ? err.message : err);
      await failDocument(document, describeExtractionError(err, document.mimeType));
      return;
    } finally {
      // The text goes into the database; the original file isn't needed after this.
      await removeUploads([document.storagePath]);
    }
    if (text.trim().length === 0) {
      await failDocument(document, FAILURE.noText);
      return;
    }

    const { questions, generatedBy } = await generateQuestions(text, document.filename, deps.llm);

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.document.updateMany({
        where: { id: documentId },
        data: { status: "READY", parsedText: text, failureReason: null },
      });
      if (updated.count === 0) return null; // deleted along with its room meanwhile
      if (questions.length === 0) return { quizId: null };
      const quiz = await tx.quiz.create({
        data: {
          roomId: document.roomId,
          documentId,
          title: `Quiz: ${document.filename}`,
          generatedBy,
          questions: {
            create: questions.map((question, index) => ({
              prompt: question.prompt,
              order: index,
              choices: {
                create: question.choices.map((choice, order) => ({
                  text: choice,
                  order,
                  isCorrect: choice === question.correctAnswer,
                })),
              },
            })),
          },
        },
        select: { id: true },
      });
      return { quizId: quiz.id };
    });
    if (!saved) return;

    emitDocumentUpdate(document, { status: "READY", failureReason: null });
    if (saved.quizId) sendToRoom(document.roomId, { type: "quiz:ready", documentId, quizId: saved.quizId });
  } catch (err) {
    console.error(`Failed to process document ${documentId}:`, err);
    await failDocument(document, FAILURE.unexpected).catch(() => {});
  }
}

/** On boot: anything still PENDING or PARSING was cut off by a restart, so run it again. */
export async function recoverInterruptedDocuments(): Promise<number> {
  const stuck = await prisma.document.findMany({
    where: { status: { in: ["PENDING", "PARSING"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  for (const { id } of stuck) enqueue(() => processDocument(id));
  return stuck.length;
}
