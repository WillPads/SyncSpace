import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const SAMPLE_TEXT = `The Pomodoro technique breaks work into focused intervals separated by short breaks.
Each interval typically lasts twenty five minutes and is followed by a five minute pause.
Longer breaks happen after completing four consecutive intervals in a single session.
Regular practice improves concentration and reduces mental fatigue throughout the day.
Many software teams adopt collaborative timers to stay synchronized during remote sessions.`;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDocumentReady(
  agent: ReturnType<typeof request.agent>,
  roomId: string,
  documentId: string,
  timeoutMs = 3000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await agent.get(`/rooms/${roomId}/documents`);
    const doc = res.body.documents.find((d: { id: string }) => d.id === documentId);
    if (doc && doc.status !== "PENDING" && doc.status !== "PARSING") return doc.status;
    await wait(50);
  }
  throw new Error("Document did not finish processing in time");
}

describe("documents & quiz pipeline", () => {
  const suffix = randomUUID();
  const adminEmail = `docs-admin-${suffix}@example.com`;
  const password = "correct-horse-battery-staple";

  const app = createApp();
  const agent = request.agent(app);

  let roomId = "";
  let documentId = "";
  let quizId = "";

  afterAll(async () => {
    await prisma.quizResponse.deleteMany({ where: { attempt: { quiz: { roomId } } } });
    await prisma.quizAttempt.deleteMany({ where: { quiz: { roomId } } });
    await prisma.quizChoice.deleteMany({ where: { question: { quiz: { roomId } } } });
    await prisma.quizQuestion.deleteMany({ where: { quiz: { roomId } } });
    await prisma.quiz.deleteMany({ where: { roomId } });
    await prisma.document.deleteMany({ where: { roomId } });
    await prisma.pomodoroSession.deleteMany({ where: { roomId } });
    await prisma.participant.deleteMany({ where: { roomId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
  });

  it("sets up the admin and room", async () => {
    const res = await agent.post("/auth/register").send({ email: adminEmail, password, displayName: "Admin" });
    expect(res.status).toBe(201);
    const roomRes = await agent.post("/rooms").send({ name: "Docs Room" });
    expect(roomRes.status).toBe(201);
    roomId = roomRes.body.room.id;
  });

  it("rejects an unsupported file type", async () => {
    const res = await agent
      .post(`/rooms/${roomId}/documents`)
      .attach("file", Buffer.from("binary"), { filename: "notes.exe", contentType: "application/octet-stream" });
    expect(res.status).toBe(400);
  });

  it("uploads a text file and asynchronously produces a ready document and a quiz", async () => {
    const uploadRes = await agent
      .post(`/rooms/${roomId}/documents`)
      .attach("file", Buffer.from(SAMPLE_TEXT), { filename: "notes.txt", contentType: "text/plain" });
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.document.status).toBe("PENDING");
    documentId = uploadRes.body.document.id;

    const finalStatus = await waitForDocumentReady(agent, roomId, documentId);
    expect(finalStatus).toBe("READY");

    const quizzesRes = await agent.get(`/rooms/${roomId}/quizzes`);
    expect(quizzesRes.status).toBe(200);
    expect(quizzesRes.body.quizzes.length).toBeGreaterThan(0);
    quizId = quizzesRes.body.quizzes[0].id;
    expect(quizzesRes.body.quizzes[0].questionCount).toBeGreaterThan(0);
  });

  it("serves quiz questions without revealing the correct choice", async () => {
    const res = await agent.get(`/rooms/${roomId}/quizzes/${quizId}`);
    expect(res.status).toBe(200);
    expect(res.body.quiz.questions.length).toBeGreaterThan(0);
    for (const question of res.body.quiz.questions) {
      for (const choice of question.choices) {
        expect(choice.isCorrect).toBeUndefined();
      }
    }
  });

  it("scores a submitted attempt against the correct choices", async () => {
    const questions = await prisma.quizQuestion.findMany({ where: { quizId }, include: { choices: true } });

    const correctResponses = questions.map((q) => ({
      questionId: q.id,
      choiceId: q.choices.find((c) => c.isCorrect)!.id,
    }));
    const wrongResponses = questions.map((q) => ({
      questionId: q.id,
      choiceId: q.choices.find((c) => !c.isCorrect)!.id,
    }));

    const perfectRes = await agent
      .post(`/rooms/${roomId}/quizzes/${quizId}/attempts`)
      .send({ responses: correctResponses });
    expect(perfectRes.status).toBe(201);
    expect(perfectRes.body.score).toBe(questions.length);
    expect(perfectRes.body.total).toBe(questions.length);

    const zeroRes = await agent
      .post(`/rooms/${roomId}/quizzes/${quizId}/attempts`)
      .send({ responses: wrongResponses });
    expect(zeroRes.status).toBe(201);
    expect(zeroRes.body.score).toBe(0);
  });
});
