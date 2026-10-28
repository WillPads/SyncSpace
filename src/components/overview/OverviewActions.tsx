"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useSession } from "@/hooks/useSession";

const NEW_ROOM_PATH = "/dashboard?new=1";

/** Top bar of the overview page; it shares the login screen's bar styles (.auth-bar in login.css). */
export function OverviewNav() {
  const { user } = useSession();
  return (
    <header className="auth-bar">
      <Link href="/" className="brand-btn">
        <BrandMark />
        SyncSpace
      </Link>
      <div className="ovw-nav-actions">
        <a className="ovw-how" href="#how">
          How it works
        </a>
        <ThemeToggle />
        <Link className="btn btn-secondary" href={user ? "/dashboard" : "/login"}>
          {user ? "Dashboard" : "Sign in"}
        </Link>
      </div>
    </header>
  );
}

export function OpenRoomButton() {
  const { user } = useSession();
  const href = user ? NEW_ROOM_PATH : `/login?next=${encodeURIComponent(NEW_ROOM_PATH)}`;
  return (
    <Link className="btn btn-primary btn-lg" href={href}>
      Open a room
      <Icon icon={ArrowRight} />
    </Link>
  );
}
