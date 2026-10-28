import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const password = "correct-horse-battery-staple";

describe("quiz attempts and results", () => {
  const suffix = randomUUID();
  const adminEmail = `quiz-admin-${suffix}@example.com`;
  const memberEmail = `quiz-member-${suffix}@example.com`;
  const app = createApp();
  const admin = request.agent(app);
  const member = request.agent(app);

  let roomId = "";
  let quizId = "";
  let otherQuizId = "";
  let q1 = { id: "", right: "", wrong: "" };
  let q2 = { id: "", right: "", wrong: "" };

  async function makeQuiz(targetRoomId: string, uploadedById: string) {
    const document = await prisma.document.create({
      data: { roomId: targetRoomId, uploadedById, filename: "notes.txt", storagePath: "gone.txt", mimeType: "text/plain", status: "READY" },
    });
    return prisma.quiz.create({
      data: {
        roomId: targetRoomId,
        documentId: document.id,
        title: "Quiz: notes.txt",
        questions: {
          create: [
            {
              prompt: "Q1",
              order: 0,
              choices: {
                create: [
                  { text: "B", order: 1, isCorrect: false },
                  { text: "A", order: 0, isCorrect: true },
                ],
              },
            },
            {
              prompt: "Q2",
              order: 1,
              choices: {
                create: [
                  { text: "C", order: 0, isCorrect: false },
                  { text: "D", order: 1, isCorrect: true },
                ],
              },
            },
          ],
        },
      },
      include: { questions: { orderBy: { order: "asc" }, include: { choices: true } } },
    });
  }

  beforeAll(async () => {
    const adminId = (await admin.post("/auth/register").send({ email: adminEmail, password, displayName: "Admin" }))
      .body.user.id;
    await member.post("/auth/register").send({ email: memberEmail, password, displayName: "Member" }).expect(201);
    const created = await admin.post("/rooms").send({ name: "Quiz Room", inviteEnabled: true }).expect(201);
    roomId = created.body.room.id;
    await member.post(`/rooms/${created.body.room.code}/join`).send({}).expect(201);

    const quiz = await makeQuiz(roomId, adminId);
    quizId = quiz.id;
    const pick = (index: number) => {
      const question = quiz.questions[index];
      return {
        id: question.id,
        right: question.choices.find((c) => c.isCorrect)!.id,
        wrong: question.choices.find((c) => !c.isCorrect)!.id,
      };
    };
    q1 = pick(0);
    q2 = pick(1);

    const otherRoom = await admin.post("/rooms").send({ name: "Other Room" }).expect(201);
    otherQuizId = (await makeQuiz(otherRoom.body.room.id, adminId)).id;
  });

  afterAll(async () => {
    // Room.admin is Restrict, so the rooms go first (their documents, quizzes and attempts cascade), then the users.
    await prisma.room.deleteMany({ where: { admin: { email: { in: [adminEmail, memberEmail] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, memberEmail] } } });
  });

  const submit = (agent: typeof admin, responses: { questionId: string; choiceId: string }[], id = quizId) =>
    agent.post(`/rooms/${roomId}/quizzes/${id}/attempts`).send({ responses });

  it("serves choices in their stored order without the answers", async () => {
    const res = await member.get(`/rooms/${roomId}/quizzes/${quizId}`).expect(200);
    expect(res.body.quiz.questions.map((q: { prompt: string }) => q.prompt)).toEqual(["Q1", "Q2"]);
    expect(res.body.quiz.questions[0].choices.map((c: { text: string }) => c.text)).toEqual(["A", "B"]);
    expect(JSON.stringify(res.body)).not.toContain("isCorrect");
  });

  it("refuses answers outside the quiz phase", async () => {
    const res = await submit(member, [
      { questionId: q1.id, choiceId: q1.right },
      { questionId: q2.id, choiceId: q2.right },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_QUIZ_PHASE");
  });

  it("rejects answer sheets that try to game the score", async () => {
    await admin.post(`/rooms/${roomId}/session`).send({ action: "start" }).expect(200);
    await admin.post(`/rooms/${roomId}/session`).send({ action: "endSession" }).expect(200);

    // The same correct answer five times used to score 5 out of 2.
    const repeated = await submit(member, Array.from({ length: 5 }, () => ({ questionId: q1.id, choiceId: q1.right })));
    expect(repeated.status).toBe(400);

    const foreignChoice = await submit(member, [
      { questionId: q1.id, choiceId: q2.right },
      { questionId: q2.id, choiceId: q2.right },
    ]);
    expect(foreignChoice.status).toBe(400);

    const unknownQuestion = await submit(member, [
      { questionId: randomUUID(), choiceId: q1.right },
      { questionId: q2.id, choiceId: q2.right },
    ]);
    expect(unknownQuestion.status).toBe(400);

    const incomplete = await submit(member, [{ questionId: q1.id, choiceId: q1.right }]);
    expect(incomplete.status).toBe(400);
    expect(incomplete.body.code).toBe("INCOMPLETE_ATTEMPT");

    expect(await prisma.quizAttempt.count({ where: { quizId } })).toBe(0);
  });

  it("only accepts quizzes that belong to the room", async () => {
    const res = await submit(member, [{ questionId: q1.id, choiceId: q1.right }], otherQuizId);
    expect(res.status).toBe(404);
    expect((await member.get(`/rooms/${roomId}/quizzes/${otherQuizId}`)).status).toBe(404);
  });

  it("scores a valid attempt on the server and reveals the answers afterwards", async () => {
    const res = await submit(member, [
      { questionId: q1.id, choiceId: q1.right },
      { questionId: q2.id, choiceId: q2.wrong },
    ]);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ score: 1, total: 2, correctChoices: { [q1.id]: q1.right, [q2.id]: q2.right } });
  });

  it("reports each person's first and best attempt", async () => {
    await submit(member, [
      { questionId: q1.id, choiceId: q1.right },
      { questionId: q2.id, choiceId: q2.right },
    ]).expect(201);
    await submit(admin, [
      { questionId: q1.id, choiceId: q1.wrong },
      { questionId: q2.id, choiceId: q2.wrong },
    ]).expect(201);

    const res = await admin.get(`/rooms/${roomId}/quizzes/${quizId}/results`).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.results).toEqual([
      expect.objectContaining({ displayName: "Member", firstScore: 1, bestScore: 2, attempts: 2 }),
      expect.objectContaining({ displayName: "Admin", firstScore: 0, bestScore: 0, attempts: 1 }),
    ]);
  });
});
