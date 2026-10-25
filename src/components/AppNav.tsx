"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useSession } from "@/hooks/useSession";
import { initials } from "@/lib/avatar";
import type { User } from "@/lib/types";

export function AppNav({ user, current }: { user: User; current: "dashboard" | "room" }) {
  const { signOut } = useSession();
  const router = useRouter();

  async function handleSignOut() {
    await signOut().catch(() => {});
    router.replace("/login");
  }

  return (
    <nav className="nav app-nav">
      <Brand href="/dashboard" hideNameOnPhones />
      <Link href="/dashboard" aria-current={current === "dashboard" ? "page" : undefined}>
        Dashboard
      </Link>
      {current === "room" && (
        <span className="nav-crumb" aria-current="page">
          Room
        </span>
      )}
      <ThemeToggle />
      <span className="me" title={user.displayName}>
        {initials(user.displayName)}
      </span>
      <button
        className="btn btn-ghost btn-icon"
        type="button"
        title="Sign out"
        aria-label="Sign out"
        onClick={() => void handleSignOut()}
      >
        <Icon icon={LogOut} size={18} />
      </button>
    </nav>
  );
}
