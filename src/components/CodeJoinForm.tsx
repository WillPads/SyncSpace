"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

/** Accepts a bare room code or a pasted invite link, and hands off to /join/<code>. */
export function CodeJoinForm({ id }: { id: string }) {
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
      <label className="sr-only" htmlFor={id}>
        Room code
      </label>
      <input
        className="input"
        id={id}
        placeholder="Room code"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button className="btn btn-secondary" type="submit">
        Join
      </button>
    </form>
  );
}
