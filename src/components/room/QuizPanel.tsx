"use client";

import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import useSWR from "swr";
import { Icon } from "@/components/ui/Icon";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Quiz, QuizResult, QuizSummary, Session } from "@/lib/types";

/** Replaces the timer while the room is in the quiz phase (after the host ends a session). */
export function QuizPanel({
  roomId,
  session,
  isAdmin,
  busy,
  quizVersion,
  onReset,
}: {
  roomId: string;
  session: Session;
  isAdmin: boolean;
  busy: boolean;
  quizVersion: number;
  onReset: () => void;
}) {
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
  const { data: quizzes, error, mutate } = useSWR<QuizSummary[]>(["quizzes", roomId], () => api.listQuizzes(roomId));

  useEffect(() => {
    if (quizVersion > 0) void mutate();
  }, [quizVersion, mutate]);

  const rounds = session.sessionsCompleted;

  return (
    <>
      <section className="tile tile-tint rm-quiz-head" aria-labelledby="rm-quiz-h">
        <div className="rm-quiz-copy">
          <span className="rm-phase">Quiz phase</span>
          <h2 id="rm-quiz-h">Session complete</h2>
          <p className="rm-sub">
            {rounds} focus {rounds === 1 ? "round" : "rounds"} done. Test yourself on the notes shared in this room.
          </p>
        </div>
        {isAdmin ? (
          <button className="btn btn-secondary btn-lg rm-reset" type="button" disabled={busy} onClick={onReset}>
            <Icon icon={RotateCcw} />
            Back to idle
          </button>
        ) : (
          <span className="rm-note">The host resets the room for the next session</span>
        )}
      </section>

      {activeQuizId ? (
        <QuizRunner roomId={roomId} quizId={activeQuizId} onBack={() => setActiveQuizId(null)} />
      ) : (
        <section className="tile rm-card" aria-labelledby="rm-quizzes-h">
          <h2 id="rm-quizzes-h">Quizzes</h2>
          {error ? (
            <div className="empty">
              <p>{errorMessage(error)}</p>
            </div>
          ) : quizzes && quizzes.length === 0 ? (
            <div className="empty">
              <p>No quizzes yet. Upload notes under Session notes and a quiz appears here once they&apos;re processed.</p>
            </div>
          ) : (
            <div className="rm-quiz-list">
              {quizzes?.map((quiz) => (
                <button className="rm-quiz-pick" type="button" key={quiz.id} onClick={() => setActiveQuizId(quiz.id)}>
                  <span className="rm-quiz-title">{quiz.title}</span>
                  <span className="rm-quiz-meta">
                    {quiz.questionCount} {quiz.questionCount === 1 ? "question" : "questions"}
                    <Icon icon={ArrowRight} size={14} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function QuizRunner({ roomId, quizId, onBack }: { roomId: string; quizId: string; onBack: () => void }) {
  const { data: quiz, error } = useSWR<Quiz>(["quiz", roomId, quizId], () => api.getQuiz(roomId, quizId));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const allAnswered = !!quiz && quiz.questions.every((question) => answers[question.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const responses = Object.entries(answers).map(([questionId, choiceId]) => ({ questionId, choiceId }));
      setResult(await api.submitAttempt(roomId, quizId, responses));
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function retry() {
    setAnswers({});
    setResult(null);
  }

  return (
    <form className="tile rm-card rm-quiz" onSubmit={handleSubmit}>
      <div className="rm-quiz-bar">
        <button className="btn btn-secondary" type="button" onClick={onBack}>
          <Icon icon={ArrowLeft} size={14} />
          All quizzes
        </button>
        {result && (
          <span className="rm-score" role="status">
            {result.score} / {result.total} correct
          </span>
        )}
      </div>
      {error && <p className="form-err">{errorMessage(error)}</p>}
      {quiz && (
        <>
          <h2>{quiz.title}</h2>
          {quiz.questions.map((question, index) => {
            const correctId = result?.correctChoices[question.id];
            return (
              <fieldset className="rm-q" key={question.id}>
                <legend className="rm-q-prompt">
                  <span className="rm-q-n">{String(index + 1).padStart(2, "0")}</span> {question.prompt}
                </legend>
                <div className="radio-stack">
                  {question.choices.map((choice) => {
                    const picked = answers[question.id] === choice.id;
                    return (
                      <label
                        key={choice.id}
                        className={cn(
                          "radio rm-choice",
                          result && choice.id === correctId && "is-correct",
                          result && picked && choice.id !== correctId && "is-wrong"
                        )}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          checked={picked}
                          disabled={!!result}
                          onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: choice.id }))}
                        />
                        <span className="dot" />
                        {choice.text}
                        {result && choice.id === correctId && <span className="rm-mark is-correct">Correct answer</span>}
                        {result && picked && choice.id !== correctId && <span className="rm-mark is-wrong">Your answer</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
          {submitError && (
            <p className="form-err" role="alert">
              {submitError}
            </p>
          )}
          <div className="rm-controls rm-quiz-actions">
            {result ? (
              <button className="btn btn-secondary btn-lg" type="button" onClick={retry}>
                <Icon icon={RotateCcw} />
                Try again
              </button>
            ) : (
              <button className="btn btn-primary btn-lg" type="submit" disabled={!allAnswered || submitting}>
                {submitting ? "Checking…" : "Submit answers"}
              </button>
            )}
          </div>
        </>
      )}
    </form>
  );
}
