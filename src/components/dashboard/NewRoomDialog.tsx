"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Corners } from "@/components/ui/Corners";
import { api, errorMessage } from "@/lib/api";

const FOCUS_OPTIONS = [25, 50];
const BREAK_OPTIONS = [5, 10];

export function NewRoomDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [focus, setFocus] = useState(FOCUS_OPTIONS[0]!);
  const [brk, setBrk] = useState(BREAK_OPTIONS[0]!);
  const [invitesOpen, setInvitesOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const room = await api.createRoom({
        name: name.trim() || "Untitled room",
        focusDurationSec: focus * 60,
        breakDurationSec: brk * 60,
        inviteEnabled: invitesOpen,
      });
      router.push(`/room/${room.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        // Only a press that lands on the backdrop itself closes the dialog.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="dialog blueprint"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
        onSubmit={handleSubmit}
      >
        <Corners />
        <span className="dialog-title" id="create-title">
          New room
        </span>
        <div className="field">
          <label htmlFor="new-name">Room name</label>
          <input
            ref={nameRef}
            className="input"
            id="new-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Finals week sprint"
            maxLength={60}
            autoComplete="off"
          />
        </div>
        <div className="dialog-row">
          <SegmentedMinutes label="Focus" name="focus" options={FOCUS_OPTIONS} value={focus} onChange={setFocus} />
          <SegmentedMinutes label="Break" name="brk" options={BREAK_OPTIONS} value={brk} onChange={setBrk} />
        </div>
        <div className="field">
          <span className="field-label" id="vis-label">
            Who can join
          </span>
          <div className="radio-stack" role="radiogroup" aria-labelledby="vis-label">
            <label className="radio">
              <input type="radio" name="vis" checked={invitesOpen} onChange={() => setInvitesOpen(true)} />
              <span className="dot" />
              Anyone with the room code or invite link
            </label>
            <label className="radio">
              <input type="radio" name="vis" checked={!invitesOpen} onChange={() => setInvitesOpen(false)} />
              <span className="dot" />
              Nobody yet. I&apos;ll open invites from the room
            </label>
          </div>
        </div>
        {error && (
          <p className="form-err" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary blueprint" type="submit" disabled={submitting}>
            <Corners />
            {submitting ? "Creating…" : "Create and enter"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SegmentedMinutes({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field">
      <span className="field-label" id={`${name}-label`}>
        {label}
      </span>
      <div className="seg" role="radiogroup" aria-labelledby={`${name}-label`}>
        {options.map((minutes) => (
          <label className="seg-opt" key={minutes}>
            <input type="radio" name={name} checked={value === minutes} onChange={() => onChange(minutes)} />
            {minutes} min
          </label>
        ))}
      </div>
    </div>
  );
}
