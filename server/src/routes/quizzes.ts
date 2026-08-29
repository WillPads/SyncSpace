import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoomRole } from "../middleware/requireRoomRole.js";

export const quizzesRouter = Router();

quizzesRouter.get("/:roomId/quizzes", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
  const quizzes = await prisma.quiz.findMany({
    where: { roomId: req.params.roomId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { questions: true } } },
  });
  res.json({
    quizzes: quizzes.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      documentId: quiz.documentId,
      createdAt: quiz.createdAt,
      questionCount: quiz._count.questions,
    })),
  });
});

quizzesRouter.get(
  "/:roomId/quizzes/:quizId",
  requireAuth,
  requireRoomRole("ADMIN", "MEMBER"),
  async (req, res) => {
    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.quizId },
      include: { questions: { orderBy: { order: "asc" }, include: { choices: { select: { id: true, text: true } } } } },
    });
    if (!quiz || quiz.roomId !== req.params.roomId) {
      res.status(404).json({ error: "Quiz not found." });
      return;
    }

    res.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        questions: quiz.questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          choices: question.choices,
        })),
      },
    });
  }
);

const attemptSchema = z.object({
  responses: z.array(z.object({ questionId: z.string().min(1), choiceId: z.string().min(1) })).min(1),
});

quizzesRouter.post(
  "/:roomId/quizzes/:quizId/attempts",
  requireAuth,
  requireRoomRole("ADMIN", "MEMBER"),
  async (req, res) => {
    const parsed = attemptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input." });
      return;
    }

    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.quizId },
      include: { questions: { include: { choices: true } } },
    });
    if (!quiz || quiz.roomId !== req.params.roomId) {
      res.status(404).json({ error: "Quiz not found." });
      return;
    }

    const correctByQuestion = new Map(
      quiz.questions.map((question) => [question.id, question.choices.find((c) => c.isCorrect)?.id])
    );

    let score = 0;
    for (const response of parsed.data.responses) {
      if (correctByQuestion.get(response.questionId) === response.choiceId) score += 1;
    }

    const attempt = await prisma.quizAttempt.create({
      data: {
        quizId: quiz.id,
        userId: req.user!.id,
        score,
        completedAt: new Date(),
        responses: { create: parsed.data.responses },
      },
    });

    res.status(201).json({
      attemptId: attempt.id,
      score,
      total: quiz.questions.length,
      correctChoices: Object.fromEntries(correctByQuestion),
    });
  }
);
