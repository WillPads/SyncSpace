"use client";

import { LoaderCircle, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useNotes } from "@/hooks/useNotes";
import { friendlyError } from "@/lib/api";

const HOLES = [0, 1, 2, 3, 4, 5];

/** The "Notes" notepad: up to five short, private lines on ruled paper. */
export function NotesTile() {
  const { notes, limit, error, isLoading, add, remove, retry } = useNotes();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const full = notes !== undefined && notes.length >= limit;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value || saving || full) return;
    setSaving(true);
    setMessage(null);
    try {
      await add(value);
      setText("");
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setMessage(null);
    try {
      await remove(id);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }

  return (
    <section className="tile dash-notepad" aria-labelledby="notepad-h">
      <div className="tile-head">
        <h2 id="notepad-h">Notes</h2>
        <span className="help">{notes ? `${notes.length} of ${limit} saved` : "Up to 5 short notes"}</span>
      </div>
      <div className="pad-holes" aria-hidden="true">
        {HOLES.map((n) => (
          <i key={n} />
        ))}
      </div>
      <div className="paper">
        <form onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="note-input">
            New note
          </label>
          <input
            id="note-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={120}
            autoComplete="off"
            placeholder={full ? "Notepad full" : "Write a note…"}
            disabled={full || saving}
          />
          <button className="btn btn-secondary save" type="submit" disabled={full || saving || !text.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
        {error && !notes ? (
          <div className="paper-msg" role="alert">
            <p>{friendlyError(error)}</p>
            <button className="btn btn-secondary" type="button" onClick={() => void retry()}>
              Try again
            </button>
          </div>
        ) : isLoading ? (
          <p className="paper-msg" role="status">
            <Icon icon={LoaderCircle} size={16} className="spin" />
            Loading notes…
          </p>
        ) : notes && notes.length === 0 ? (
          <p className="paper-empty">No notes yet. Jot down a reminder above.</p>
        ) : (
          <ul>
            {notes?.map((note) => (
              <li key={note.id}>
                <span className="note-text" title={note.text}>
                  {note.text}
                </span>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`Delete note: ${note.text}`}
                  title="Delete note"
                  onClick={() => void handleRemove(note.id)}
                >
                  <Icon icon={X} size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {message ? (
        <p className="form-err" role="alert">
          {message}
        </p>
      ) : (
        <p className="help">
          {full ? `Your notepad is full (${limit} notes). Delete one to add another.` : "Private to you. Notes are 120 characters at most."}
        </p>
      )}
    </section>
  );
}
