"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { AppBackdrop } from "@/components/ui/Backdrop";
import { BrandMark } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";
import { ScreenMessage } from "@/components/ui/ScreenMessage";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SESSION_KEY, useSession } from "@/hooks/useSession";
import { useSignOut } from "@/hooks/useSignOut";

type Kind = "signed-out" | "deleted";

const COPY: Record<
  Kind,
  { eyebrow: string; title: string; text: string; listTitle: string; gone: boolean; items: { title: string; text: string }[] }
> = {
  "signed-out": {
    eyebrow: "Logged out",
    title: "See you at the next focus round.",
    text: "You are logged out on this device. Everything you saved is waiting for when you log back in.",
    listTitle: "Still saved",
    gone: false,
    items: [
      { title: "Your rooms", text: "The rooms you joined and the ones you host." },
      { title: "Notes and files", text: "Your notepad, quick note and recent files." },
      { title: "Appearance", text: "Theme and background animation, saved in this browser." },
    ],
  },
  deleted: {
    eyebrow: "Account deleted",
    title: "Your account is gone.",
    text: "Rooms you hosted went to the member who had been there longest, or were deleted if nobody else was in them.",
    listTitle: "What was removed",
    gone: true,
    items: [
      { title: "Your account", text: "Your name, email and password." },
      { title: "Notes and quiz scores", text: "Your notepad, quick note and quiz attempts." },
      { title: "Room memberships", text: "You left every room you were in. Your chat messages and uploads stay in those rooms as \"Deleted user\"." },
    ],
  },
};

export default function SignedOutPage() {
  return (
    <Suspense>
      <SignedOutScreen />
    </Suspense>
  );
}

function SignedOutScreen() {
  const kind: Kind = useSearchParams().get("account") === "deleted" ? "deleted" : "signed-out";
  const { user, error, retry } = useSession();
  const { mutate } = useSWRConfig(); // a stable function, so the effect below runs once
  const { signOut, pending } = useSignOut();
  const [checked, setChecked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const copy = COPY[kind];

  // Arriving here from "Sign out" or "Delete account" leaves the old signed-in session in the cache
  // (see hooks/useSignOut.ts). Asking the server once clears it on a 401, and it also keeps this
  // page honest: if the request that should have signed you out failed, it says so below.
  useEffect(() => {
    void Promise.resolve(mutate(SESSION_KEY))
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [mutate]);

  const showCopy = checked && !error && !user;
  useEffect(() => {
    // A new page was just shown: move focus to its heading so screen readers announce it.
    if (showCopy) heading.current?.focus();
  }, [showCopy]);

  return (
    <div className="redesign app-screen auth-screen">
      <AppBackdrop />
      <header className="auth-bar">
        <Link href="/" className="brand-btn">
          <BrandMark />
          SyncSpace
        </Link>
        <ThemeToggle />
      </header>

      {!checked ? (
        <ScreenMessage loading title="Loading" />
      ) : error ? (
        <ScreenMessage title="Can't reach SyncSpace" body={error.message}>
          <button className="btn btn-secondary" type="button" onClick={() => void retry()}>
            Try again
          </button>
        </ScreenMessage>
      ) : user ? (
        <ScreenMessage title="You're still signed in" body={`Signed in as ${user.email}.`}>
          <Link className="btn btn-primary" href="/dashboard">
            Go to dashboard
          </Link>
          <button
            className="btn btn-secondary"
            type="button"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) void signOut();
            }}
          >
            Sign out
          </button>
        </ScreenMessage>
      ) : (
        <main className="out">
          <section className="tile tile-tint out-hero" aria-labelledby="out-h">
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1 id="out-h" ref={heading} tabIndex={-1}>
              {copy.title}
            </h1>
            <p className="out-sub">{copy.text}</p>
            <div className="out-actions">
              <Link className="btn btn-primary btn-lg" href={kind === "deleted" ? "/login?mode=register" : "/login"}>
                {kind === "deleted" ? "Create a new account" : "Log back in"}
              </Link>
              <Link className="btn btn-secondary btn-lg" href="/">
                About SyncSpace
              </Link>
            </div>
          </section>

          <section className="tile out-list" aria-labelledby="out-h2">
            <h2 id="out-h2">{copy.listTitle}</h2>
            <ul className="ticks">
              {copy.items.map((item) => (
                <li key={item.title}>
                  <span className={copy.gone ? "tick-ico is-gone" : "tick-ico"} aria-hidden="true">
                    <Icon icon={copy.gone ? X : Check} size={18} />
                  </span>
                  <span>
                    <b>{item.title}</b>
                    <span className="tick-text">{item.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </main>
      )}
    </div>
  );
}
