"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { ScreenMessage } from "@/components/ui/ScreenMessage";
import { useSession } from "@/hooks/useSession";
import type { User } from "@/lib/types";

/** Renders its children only for a signed-in user; everyone else is sent to /login. */
export function RequireAuth({ children }: { children: (user: User) => ReactNode }) {
  const { user, isLoading, error, retry } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !error && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isLoading, error, user, router, pathname]);

  if (error) {
    return (
      <ScreenMessage title="Can't reach SyncSpace" body={error.message}>
        <button className="btn btn-secondary" type="button" onClick={() => void retry()}>
          Try again
        </button>
      </ScreenMessage>
    );
  }
  if (!user) return <ScreenMessage loading title="Loading" />;
  return <>{children(user)}</>;
}
