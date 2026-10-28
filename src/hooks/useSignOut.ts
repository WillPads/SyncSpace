"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";

export const SIGNED_OUT_PATH = "/signed-out";

/**
 * Signs out, then shows the logged-out screen.
 *
 * The cached session is deliberately NOT cleared here. If it were, RequireAuth on the page we are
 * leaving would see "no user" and race us to /login. The /signed-out page re-checks with the
 * server on arrival, which drops the stale cache and also makes sure we never claim "signed out"
 * when the request actually failed.
 */
export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const signOut = useCallback(async () => {
    setPending(true);
    try {
      await api.logout();
    } catch {
      // Already signed out (401) is the outcome we wanted. Any other failure: the logged-out page
      // re-checks with the server and says so if we are still signed in.
    }
    router.replace(SIGNED_OUT_PATH);
  }, [router]);

  return { signOut, pending };
}
