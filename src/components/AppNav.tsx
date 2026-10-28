"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { Brand } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SESSION_KEY } from "@/hooks/useSession";
import { useSignOut } from "@/hooks/useSignOut";
import { ApiError, api } from "@/lib/api";
import { initials } from "@/lib/avatar";
import type { User } from "@/lib/types";

export function AppNav({ user, current }: { user: User; current: "dashboard" | "room" | "settings" }) {
  const { signOut, pending } = useSignOut();
  const { mutate } = useSWRConfig();

  // Signed out somewhere else (for example "change password" on another device ends this session)?
  // The cached user would stay on screen until a request happens to fail. Asking the server when
  // the tab becomes visible again means that only a 401 clears the session (RequireAuth then shows
  // the login screen); a network blip is ignored so it can't blank the page.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      api.me().catch((err) => {
        if (err instanceof ApiError && err.status === 401) void mutate(SESSION_KEY, null, false);
      });
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [mutate]);

  return (
    <nav className="nav app-nav">
      <Brand href="/dashboard" hideNameOnPhones />
      <Link href="/dashboard" className="nav-link" aria-current={current === "dashboard" ? "page" : undefined}>
        Dashboard
      </Link>
      {current === "room" && (
        <span className="nav-crumb" aria-current="page">
          Room
        </span>
      )}
      <ThemeToggle />
      <Link
        href="/settings"
        className="me-link"
        aria-label={`Settings for ${user.displayName}`}
        title="Settings"
        aria-current={current === "settings" ? "page" : undefined}
      >
        <span className="me" aria-hidden="true">
          {initials(user.displayName)}
        </span>
      </Link>
      <button
        className="btn btn-ghost btn-icon"
        type="button"
        title="Sign out"
        aria-label="Sign out"
        aria-disabled={pending || undefined}
        onClick={() => {
          if (!pending) void signOut();
        }}
      >
        <Icon icon={LogOut} size={18} />
      </button>
    </nav>
  );
}
