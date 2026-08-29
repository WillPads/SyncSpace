import { describe, expect, it } from "vitest";
import { generateQuiz } from "../src/lib/quizgen.js";

const SAMPLE_TEXT = `The Pomodoro technique breaks work into focused intervals separated by short breaks.
Each interval typically lasts twenty five minutes and is followed by a five minute pause.
Longer breaks happen after completing four consecutive intervals in a single session.
Regular practice improves concentration and reduces mental fatigue throughout the day.
Many software teams adopt collaborative timers to stay synchronized during remote sessions.`;

describe("generateQuiz", () => {
  it("returns no questions for text with no usable sentences", () => {
    expect(generateQuiz("Hi. Ok. No.")).toEqual([]);
  });

  it("returns no questions for empty text", () => {
    expect(generateQuiz("")).toEqual([]);
  });

  it("generates cloze questions with the blank and a plausible answer set", () => {
    const questions = generateQuiz(SAMPLE_TEXT);

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(5);

    for (const question of questions) {
      expect(question.prompt).toContain("_____");
      expect(question.prompt).not.toContain(question.correctAnswer);
      expect(question.choices).toContain(question.correctAnswer);
      expect(question.choices.length).toBeGreaterThanOrEqual(3);
      expect(new Set(question.choices).size).toBe(question.choices.length);
    }
  });

  it("never repeats the same answer across questions", () => {
    const questions = generateQuiz(SAMPLE_TEXT);
    const answers = questions.map((q) => q.correctAnswer.toLowerCase());
    expect(new Set(answers).size).toBe(answers.length);
  });
});
