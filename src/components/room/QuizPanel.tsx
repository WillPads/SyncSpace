"use client";

import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import useSWR from "swr";
import { Corners } from "@/components/ui/Corners";
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
      <div className="quiz-head blueprint">
        <Corners />
        <div className="quiz-head-copy">
          <span className="eyebrow">Quiz phase</span>
          <h3>Session complete</h3>
          <p className="muted">
            {rounds} focus {rounds === 1 ? "round" : "rounds"} done. Test yourself on the notes shared in this room.
          </p>
        </div>
        {isAdmin ? (
          <button className="btn btn-secondary btn-lg" type="button" disabled={busy} onClick={onReset}>
            <Icon icon={RotateCcw} />
            Back to idle
          </button>
        ) : (
          <span className="host-note">The host resets the room for the next session</span>
        )}
      </div>

      {activeQuizId ? (
        <QuizRunner roomId={roomId} quizId={activeQuizId} onBack={() => setActiveQuizId(null)} />
      ) : (
        <div className="section">
          <h3>Quizzes</h3>
          {error ? (
            <div className="empty">
              <p>{errorMessage(error)}</p>
            </div>
          ) : quizzes && quizzes.length === 0 ? (
            <div className="empty">
              <p>No quizzes yet. Upload notes under Session notes and a quiz appears here once they&apos;re processed.</p>
            </div>
          ) : (
            <div className="quiz-list">
              {quizzes?.map((quiz) => (
                <button className="quiz-pick card blueprint" type="button" key={quiz.id} onClick={() => setActiveQuizId(quiz.id)}>
                  <Corners />
                  <span className="card-title">{quiz.title}</span>
                  <span className="card-meta">
                    {quiz.questionCount} {quiz.questionCount === 1 ? "question" : "questions"}
                    <Icon icon={ArrowRight} size={14} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
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
    <form className="section quiz" onSubmit={handleSubmit}>
      <div className="row-between">
        <button className="btn btn-ghost" type="button" onClick={onBack}>
          <Icon icon={ArrowLeft} size={14} />
          All quizzes
        </button>
        {result && (
          <span className="quiz-score" role="status">
            {result.score} / {result.total} correct
          </span>
        )}
      </div>
      {error && <p className="form-err">{errorMessage(error)}</p>}
      {quiz && (
        <>
          <h3>{quiz.title}</h3>
          {quiz.questions.map((question, index) => {
            const correctId = result?.correctChoices[question.id];
            return (
              <fieldset className="quiz-q" key={question.id}>
                <legend className="quiz-prompt">
                  <span className="step-n">{String(index + 1).padStart(2, "0")}</span> {question.prompt}
                </legend>
                <div className="radio-stack">
                  {question.choices.map((choice) => {
                    const picked = answers[question.id] === choice.id;
                    return (
                      <label
                        key={choice.id}
                        className={cn(
                          "radio quiz-choice",
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
          <div className="controls quiz-actions">
            {result ? (
              <button className="btn btn-secondary btn-lg" type="button" onClick={retry}>
                <Icon icon={RotateCcw} />
                Try again
              </button>
            ) : (
              <button className="btn btn-primary blueprint btn-lg" type="submit" disabled={!allAnswered || submitting}>
                <Corners />
                {submitting ? "Checking…" : "Submit answers"}
              </button>
            )}
          </div>
        </>
      )}
    </form>
  );
}
