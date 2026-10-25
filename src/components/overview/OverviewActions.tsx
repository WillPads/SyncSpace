"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/ui/Brand";
import { Corners } from "@/components/ui/Corners";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useSession } from "@/hooks/useSession";

const NEW_ROOM_PATH = "/dashboard?new=1";

export function OverviewNav() {
  const { user } = useSession();
  return (
    <nav className="nav ov-nav">
      <Brand />
      <a href="#how">How it works</a>
      <ThemeToggle />
      <Link className="btn btn-secondary" href={user ? "/dashboard" : "/login"}>
        {user ? "Dashboard" : "Sign in"}
      </Link>
    </nav>
  );
}

export function OpenRoomButton() {
  const { user } = useSession();
  const href = user ? NEW_ROOM_PATH : `/login?next=${encodeURIComponent(NEW_ROOM_PATH)}`;
  return (
    <Link className="btn btn-primary blueprint" href={href}>
      <Corners />
      Open a room
      <Icon icon={ArrowRight} />
    </Link>
  );
}
