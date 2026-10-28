"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useSession } from "@/hooks/useSession";

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
        <ThemeToggle />
        <Link className="btn btn-secondary" href={user ? "/dashboard" : "/login"}>
          {user ? "Dashboard" : "Sign in"}
        </Link>
      </div>
    </header>
  );
}

/** The two buttons under the welcome text. Someone who is already signed in just gets the dashboard. */
export function OverviewHeroActions() {
  const { user } = useSession();
  return (
    <div className="ovw-actions">
      {user ? (
        <Link className="btn btn-primary btn-lg" href="/dashboard">
          Go to dashboard
          <Icon icon={ArrowRight} />
        </Link>
      ) : (
        <>
          <Link className="btn btn-primary btn-lg" href="/login?mode=register">
            Create account
          </Link>
          <Link className="btn btn-secondary btn-lg" href="/login">
            Sign in
          </Link>
        </>
      )}
    </div>
  );
}
