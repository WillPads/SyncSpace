"use client";

import { PenLine } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { useQuickNote } from "@/hooks/useQuickNote";
import { friendlyError } from "@/lib/api";

const STATUS_TEXT = { saved: "Saved", saving: "Saving…", error: "Not saved" } as const;

/** "Quick notes": one free-text scratch pad that saves itself a moment after you stop typing. */
export function QuickNoteTile() {
  const { text, setText, words, status, saveError, loaded, loadError, retryLoad } = useQuickNote();

  return (
    <section className="tile dash-quick" aria-labelledby="quick-h">
      <div className="tile-head">
        <h2 id="quick-h">
          <Icon icon={PenLine} size={18} />
          Quick notes
        </h2>
      </div>
      {loadError && !loaded ? (
        <div className="empty" role="alert">
          <p>{friendlyError(loadError)}</p>
          <button className="btn btn-secondary" type="button" onClick={() => void retryLoad()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <textarea
            className="quick-text"
            aria-labelledby="quick-h"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={5000}
            disabled={!loaded}
            placeholder={loaded ? "Jot down tasks, formulas or what to review next." : "Loading your note…"}
          />
          <div className="quick-foot">
            <span>
              {words} {words === 1 ? "word" : "words"}
            </span>
            <span role="status" className={status === "error" ? "quick-status is-error" : "quick-status"}>
              {STATUS_TEXT[status]}
            </span>
          </div>
          {status === "error" && saveError && (
            <p className="form-err" role="alert">
              {saveError}
            </p>
          )}
        </>
      )}
    </section>
  );
}
