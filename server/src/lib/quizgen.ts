const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "as", "by",
  "is", "are", "was", "were", "be", "been", "being", "this", "that", "these", "those", "it",
  "its", "from", "which", "who", "whom", "their", "they", "he", "she", "we", "you", "your",
  "our", "not", "have", "has", "had", "will", "would", "can", "could", "should", "into",
  "than", "then", "there", "also", "about", "after", "before", "over", "under", "between",
]);

const MAX_QUESTIONS = 5;
const MIN_SENTENCE_LEN = 30;
const MAX_SENTENCE_LEN = 220;
const MIN_DISTRACTORS = 2;
const CANDIDATE_WORD_RE = /\b[A-Za-z]{5,}\b/g;

export interface GeneratedQuestion {
  prompt: string;
  correctAnswer: string;
  choices: string[];
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SENTENCE_LEN && s.length <= MAX_SENTENCE_LEN);
}

function candidateWords(text: string): string[] {
  return [...text.matchAll(CANDIDATE_WORD_RE)].map((m) => m[0]).filter((w) => !STOPWORDS.has(w.toLowerCase()));
}

function pickBlankWord(sentence: string): string | null {
  const words = candidateWords(sentence);
  if (words.length === 0) return null;
  return words.reduce((longest, w) => (w.length > longest.length ? w : longest), words[0]);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Deterministic, dependency-free quiz generation (no LLM key available in this environment):
 * picks a spread of sentences across the document, blanks out each one's most salient word as
 * a cloze question, and draws multiple-choice distractors from salient words found elsewhere in
 * the document.
 */
export function generateQuiz(text: string): GeneratedQuestion[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const globalPool = [...new Set(candidateWords(text))];
  const questions: GeneratedQuestion[] = [];
  const usedAnswers = new Set<string>();

  const step = Math.max(1, Math.floor(sentences.length / MAX_QUESTIONS));
  for (let i = 0; i < sentences.length && questions.length < MAX_QUESTIONS; i += step) {
    const sentence = sentences[i];
    const answer = pickBlankWord(sentence);
    if (!answer || usedAnswers.has(answer.toLowerCase())) continue;

    const distractorPool = globalPool.filter(
      (w) => w.toLowerCase() !== answer.toLowerCase() && !sentence.toLowerCase().includes(w.toLowerCase())
    );
    const distractors = shuffle(distractorPool).slice(0, 3);
    if (distractors.length < MIN_DISTRACTORS) continue;

    usedAnswers.add(answer.toLowerCase());
    const prompt = sentence.replace(new RegExp(`\\b${escapeRegExp(answer)}\\b`), "_____");
    questions.push({ prompt, correctAnswer: answer, choices: shuffle([answer, ...distractors]) });
  }

  return questions;
}
