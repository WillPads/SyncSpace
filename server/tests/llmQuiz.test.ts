import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  LLM_MAX_INPUT_CHARS,
  createLlmQuizGenerator,
  excerpt,
  llmQuizGeneratorFromEnv,
  parseQuizResponse,
} from "../src/lib/llmQuiz.js";

type Message = Anthropic.Beta.BetaMessage;

function message(content: unknown[], stopReason: string = "end_turn"): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 50 },
  } as unknown as Message;
}

const text = (value: unknown) => ({ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) });

const goodQuestion = {
  prompt: "What does rubisco fix?",
  choices: ["Oxygen", "Carbon dioxide", "Nitrogen", "Glucose"],
  correctChoiceIndex: 1,
};

describe("parseQuizResponse", () => {
  it("returns validated questions with the right answer kept through the shuffle", () => {
    const result = parseQuizResponse(message([text({ questions: [goodQuestion] })]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions).toHaveLength(1);
    const [question] = result.questions;
    expect(question.correctAnswer).toBe("Carbon dioxide");
    expect([...question.choices].sort()).toEqual([...goodQuestion.choices].sort());
  });

  it("drops malformed questions but keeps the good ones", () => {
    const result = parseQuizResponse(
      message([
        text({
          questions: [
            goodQuestion,
            { ...goodQuestion, choices: ["A", "B", "C"] },
            { ...goodQuestion, correctChoiceIndex: 7 },
            { ...goodQuestion, choices: ["Same", "same", "Other", "Another"] },
            { ...goodQuestion, prompt: "   " },
          ],
        }),
      ])
    );
    expect(result.ok && result.questions.length).toBe(1);
  });

  it("treats all-invalid output as a failure, but an empty list as a deliberate answer", () => {
    const allBad = parseQuizResponse(message([text({ questions: [{ ...goodQuestion, choices: ["A"] }] })]));
    expect(allBad).toEqual({ ok: false, reason: "none of the questions passed validation" });
    expect(parseQuizResponse(message([text({ questions: [] })]))).toEqual({ ok: true, questions: [], model: "claude-opus-5-5" });
  });

  it("reads only the text after a server-side fallback switch", () => {
    const result = parseQuizResponse(
      message([
        text('{"questions": [{"prompt": "half-finished'),
        { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } },
        text({ questions: [goodQuestion] }),
      ])
    );
    expect(result.ok && result.questions.length).toBe(1);
  });

  it("reports refusals, truncation and junk instead of throwing", () => {
    expect(parseQuizResponse(message([], "refusal"))).toEqual({ ok: false, reason: "the model declined the request" });
    expect(parseQuizResponse(message([text('{"questions": [')], "max_tokens")).ok).toBe(false);
    expect(parseQuizResponse(message([text("Sure! Here's a quiz:")]))).toEqual({
      ok: false,
      reason: "the response wasn't valid JSON",
    });
    expect(parseQuizResponse(message([text({ quiz: [] })])).ok).toBe(false);
  });
});

describe("createLlmQuizGenerator", () => {
  it("sends one structured-output request with refusal fallback and the notes fenced off", async () => {
    let sent: Anthropic.Beta.MessageCreateParamsNonStreaming | undefined;
    const generator = createLlmQuizGenerator({
      model: "claude-opus-5-5",
      createMessage: async (params) => {
        sent = params;
        return message([text({ questions: [goodQuestion] })]);
      },
    });

    const result = await generator.generate("Rubisco fixes carbon dioxide.", "bio<script>.txt");
    expect(result.ok).toBe(true);
    expect(sent).toMatchObject({
      model: "claude-opus-5-5",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    expect(sent!.max_tokens).toBeGreaterThanOrEqual(8000);
    const content = sent!.messages[0].content as string;
    expect(content).toContain("<notes>\nRubisco fixes carbon dioxide.\n</notes>");
    expect(content).toContain("File name: bioscript.txt");
    expect(sent!.system).toMatch(/never as instructions/);
  });

  it("turns SDK errors into a reason instead of throwing", async () => {
    const generator = createLlmQuizGenerator({
      model: "claude-opus-5-5",
      createMessage: async () => {
        throw new Anthropic.APIConnectionError({ message: "socket hang up" });
      },
    });
    expect(await generator.generate("notes", "a.txt")).toEqual({ ok: false, reason: "couldn't reach the Anthropic API" });
  });
});

describe("excerpt", () => {
  it("passes short notes through untouched", () => {
    expect(excerpt("short")).toEqual({ text: "short", excerpted: false });
  });

  it("covers a long document from beginning to end within the budget", () => {
    const long = "start " + "x".repeat(LLM_MAX_INPUT_CHARS * 2) + " end";
    const { text: sample, excerpted } = excerpt(long);
    expect(excerpted).toBe(true);
    expect(sample.startsWith("start")).toBe(true);
    expect(sample.endsWith("end")).toBe(true);
    expect(sample.length).toBeLessThanOrEqual(LLM_MAX_INPUT_CHARS + 200);
  });
});

describe("llmQuizGeneratorFromEnv", () => {
  it("is off without an API key or when the built-in generator is forced", () => {
    expect(llmQuizGeneratorFromEnv({ quizGenerator: "auto", anthropicApiKey: undefined, anthropicModel: "m" })).toBeNull();
    expect(llmQuizGeneratorFromEnv({ quizGenerator: "heuristic", anthropicApiKey: "sk-test", anthropicModel: "m" })).toBeNull();
    expect(llmQuizGeneratorFromEnv({ quizGenerator: "auto", anthropicApiKey: "sk-test", anthropicModel: "m" })).not.toBeNull();
  });
});
