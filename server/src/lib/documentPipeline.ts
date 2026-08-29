import fs from "node:fs";
import path from "node:path";
// pdf-parse ships as CommonJS; esModuleInterop gives us a default import.
import pdfParse from "pdf-parse";
import { prisma } from "../db.js";
import { sendToRoom } from "../ws/registry.js";
import { generateQuiz } from "./quizgen.js";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export function uploadDir(): string {
  return UPLOAD_DIR;
}

async function extractText(storagePath: string, mimeType: string): Promise<string> {
  const fullPath = path.join(UPLOAD_DIR, storagePath);
  if (mimeType === "application/pdf") {
    const buffer = await fs.promises.readFile(fullPath);
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }
  return fs.promises.readFile(fullPath, "utf-8");
}

export async function processDocument(documentId: string): Promise<void> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) return;

  await prisma.document.update({ where: { id: documentId }, data: { status: "PARSING" } });

  try {
    const text = await extractText(document.storagePath, document.mimeType);
    await prisma.document.update({ where: { id: documentId }, data: { status: "READY", parsedText: text } });

    const questions = generateQuiz(text);
    if (questions.length > 0) {
      const quiz = await prisma.quiz.create({
        data: {
          roomId: document.roomId,
          documentId: document.id,
          title: `Quiz: ${document.filename}`,
          questions: {
            create: questions.map((question, index) => ({
              prompt: question.prompt,
              order: index,
              choices: {
                create: question.choices.map((choice) => ({
                  text: choice,
                  isCorrect: choice === question.correctAnswer,
                })),
              },
            })),
          },
        },
      });
      sendToRoom(document.roomId, { type: "quiz:ready", documentId: document.id, quizId: quiz.id });
    }
  } catch (err) {
    console.error(`Failed to process document ${documentId}:`, err);
    await prisma.document.update({ where: { id: documentId }, data: { status: "FAILED" } }).catch(() => {});
  }
}
