"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

/**
 * Accepts a bare room code or a pasted invite link, and hands off to /join/<code>.
 * The wording props default to the short form used on the overview page; the dashboard passes
 * longer text and shows the label.
 */
export function CodeJoinForm({
  id,
  label = "Room code",
  placeholder = "Room code",
  submitLabel = "Join",
  visibleLabel = false,
}: {
  id: string;
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  visibleLabel?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = value.trim().split("/join/").pop()?.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (!code) return;
    router.push(`/join/${code}`);
  }

  return (
    <form className="code-join" onSubmit={handleSubmit}>
      <label className={visibleLabel ? undefined : "sr-only"} htmlFor={id}>
        {label}
      </label>
      <input
        className="input"
        id={id}
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button className="btn btn-secondary" type="submit">
        {submitLabel}
      </button>
    </form>
  );
}
