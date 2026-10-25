import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError, fieldError, isUuid, parseInput, routeParam } from "../lib/http.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoomRole } from "../middleware/requireRoomRole.js";

const attemptSchema = z.object({
  responses: z
    .array(
      z.object({ questionId: z.string().min(1).max(64), choiceId: z.string().min(1).max(64) }),
      fieldError("responses", "a list of answers")
    )
    .min(1, "Answer at least one question.")
    .max(100),
});

function quizNotFound(): HttpError {
  return new HttpError(404, "QUIZ_NOT_FOUND", "Quiz not found.");
}

export function createQuizzesRouter(): Router {
  const router = Router();

  router.get("/:roomId/quizzes", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
    const quizzes = await prisma.quiz.findMany({
      where: { roomId: routeParam(req, "roomId") },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: { _count: { select: { questions: true } } },
    });
    res.json({
      quizzes: quizzes.map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        documentId: quiz.documentId,
        generatedBy: quiz.generatedBy,
        createdAt: quiz.createdAt.toISOString(),
        questionCount: quiz._count.questions,
      })),
    });
  });

  router.get("/:roomId/quizzes/:quizId", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
    const quizId = routeParam(req, "quizId");
    if (!isUuid(quizId)) throw quizNotFound();
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: {
          orderBy: { order: "asc" },
          // Never select isCorrect here: this is what players see before answering.
          include: { choices: { orderBy: { order: "asc" }, select: { id: true, text: true } } },
        },
      },
    });
    if (!quiz || quiz.roomId !== routeParam(req, "roomId")) throw quizNotFound();

    res.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        generatedBy: quiz.generatedBy,
        questions: quiz.questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          choices: question.choices,
        })),
      },
    });
  });

  router.post(
    "/:roomId/quizzes/:quizId/attempts",
    requireAuth,
    requireRoomRole("ADMIN", "MEMBER"),
    async (req, res) => {
      const { responses } = parseInput(attemptSchema, req.body);
      const roomId = routeParam(req, "roomId");
      const quizId = routeParam(req, "quizId");
      if (!isUuid(quizId)) throw quizNotFound();

      // Quizzes are part of the room's lifecycle: answers count during the quiz phase only.
      const session = await prisma.pomodoroSession.findUnique({ where: { roomId }, select: { state: true } });
      if (session?.state !== "QUIZ_PHASE") {
        throw new HttpError(409, "NOT_QUIZ_PHASE", "Quizzes can only be submitted during the quiz phase.");
      }

      const quiz = await prisma.quiz.findUnique({
        where: { id: quizId },
        include: { questions: { include: { choices: { select: { id: true, isCorrect: true } } } } },
      });
      if (!quiz || quiz.roomId !== roomId) throw quizNotFound();

      // Score on the server, from the server's own data: one answer per question, and every
      // answer must be one of that question's choices.
      const questions = new Map(quiz.questions.map((question) => [question.id, question]));
      const answered = new Set<string>();
      let score = 0;
      for (const response of responses) {
        const question = questions.get(response.questionId);
        if (!question) throw new HttpError(400, "INVALID_RESPONSE", "An answer refers to a question that isn't in this quiz.");
        if (answered.has(response.questionId)) {
          throw new HttpError(400, "INVALID_RESPONSE", "Each question can only be answered once.");
        }
        answered.add(response.questionId);
        const choice = question.choices.find((c) => c.id === response.choiceId);
        if (!choice) throw new HttpError(400, "INVALID_RESPONSE", "An answer isn't one of that question's choices.");
        if (choice.isCorrect) score += 1;
      }
      if (answered.size !== questions.size) {
        throw new HttpError(400, "INCOMPLETE_ATTEMPT", "Answer every question before submitting.");
      }

      const attempt = await prisma.quizAttempt.create({
        data: {
          quizId: quiz.id,
          userId: req.user!.id,
          score,
          completedAt: new Date(),
          responses: { create: responses },
        },
        select: { id: true },
      });

      res.status(201).json({
        attemptId: attempt.id,
        score,
        total: quiz.questions.length,
        correctChoices: Object.fromEntries(
          quiz.questions.map((question) => [question.id, question.choices.find((c) => c.isCorrect)?.id])
        ),
      });
    }
  );

  // Results for everyone in the room. The first attempt is the one that counts: once an
  // attempt is submitted the correct answers are revealed, so later ones are practice.
  router.get(
    "/:roomId/quizzes/:quizId/results",
    requireAuth,
    requireRoomRole("ADMIN", "MEMBER"),
    async (req, res) => {
      const quizId = routeParam(req, "quizId");
      if (!isUuid(quizId)) throw quizNotFound();
      const quiz = await prisma.quiz.findUnique({
        where: { id: quizId },
        select: { roomId: true, _count: { select: { questions: true } } },
      });
      if (!quiz || quiz.roomId !== routeParam(req, "roomId")) throw quizNotFound();

      const attempts = await prisma.quizAttempt.findMany({
        where: { quizId },
        orderBy: [{ completedAt: "asc" }, { id: "asc" }],
        select: { userId: true, score: true, completedAt: true, user: { select: { displayName: true } } },
      });

      const byUser = new Map<
        string,
        { userId: string; displayName: string; firstScore: number; bestScore: number; attempts: number; firstCompletedAt: string | null }
      >();
      for (const attempt of attempts) {
        const entry = byUser.get(attempt.userId);
        if (!entry) {
          byUser.set(attempt.userId, {
            userId: attempt.userId,
            displayName: attempt.user.displayName,
            firstScore: attempt.score,
            bestScore: attempt.score,
            attempts: 1,
            firstCompletedAt: attempt.completedAt?.toISOString() ?? null,
          });
        } else {
          entry.attempts += 1;
          entry.bestScore = Math.max(entry.bestScore, attempt.score);
        }
      }

      res.json({
        total: quiz._count.questions,
        results: [...byUser.values()].sort((a, b) => b.firstScore - a.firstScore),
      });
    }
  );

  return router;
}
