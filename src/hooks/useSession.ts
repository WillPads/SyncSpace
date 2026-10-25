"use client";

import useSWR from "swr";
import { ApiError, api } from "@/lib/api";
import type { User } from "@/lib/types";

const SESSION_KEY = "session";

async function fetchSession(): Promise<User | null> {
  try {
    return await api.me();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function useSession() {
  const { data, error, isLoading, mutate } = useSWR<User | null, ApiError>(SESSION_KEY, fetchSession, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  return {
    user: data ?? null,
    isLoading,
    error: error ?? null,
    retry: () => mutate(),
    signIn: async (email: string, password: string) => mutate(await api.login(email, password), false),
    register: async (email: string, password: string, displayName: string) =>
      mutate(await api.register(email, password, displayName), false),
    signOut: async () => {
      await api.logout();
      await mutate(null, false);
    },
  };
}
