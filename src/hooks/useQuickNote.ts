"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ApiError, type QuickNote, dashboardApi, friendlyError } from "@/lib/api";

const QUICK_NOTE_KEY = "me/quick-note";
const SAVE_DELAY_MS = 600; // wait for a pause in typing, like the mockup
const RETRY_DELAY_MS = 5000;

export type SaveState = "saved" | "saving" | "error";

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * The free-text scratch note with autosave.
 *
 * - SWR loads the saved text once. Focus revalidation is off so a background refetch can never
 *   overwrite what the user is typing; the text they type lives in `draft`.
 * - Autosave is debounced: every keystroke restarts a 600 ms timer, so one request goes out per
 *   pause instead of one per key (the server allows 60 saves a minute).
 * - Only one save is in flight at a time, so two requests can't arrive out of order and leave
 *   older text on the server. A keystroke during a save just re-arms the timer.
 * - When the tab is hidden, reloaded or the tile unmounts, the pending text is sent right away
 *   with `keepalive` so the browser still delivers it.
 */
export function useQuickNote() {
  const { data, error, mutate } = useSWR<QuickNote, ApiError>(QUICK_NOTE_KEY, dashboardApi.getQuickNote, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const [draft, setDraft] = useState<string | null>(null); // null until the user types
  const [status, setStatus] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);

  const draftRef = useRef<string | null>(null);
  const savedRef = useRef<string | null>(null); // last text the server confirmed
  const serverTextRef = useRef<string | undefined>(undefined);
  const inFlight = useRef(false);
  const rearm = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  serverTextRef.current = data?.text;

  const flush = useCallback(async (keepalive = false) => {
    clearTimeout(timer.current);
    if (inFlight.current) {
      rearm.current = true; // the running save will re-arm the timer when it finishes
      return;
    }
    const body = draftRef.current;
    if (body === null || body === (savedRef.current ?? serverTextRef.current)) {
      setStatus("saved");
      return;
    }
    inFlight.current = true;
    setStatus("saving");
    try {
      await dashboardApi.saveQuickNote(body, keepalive);
      savedRef.current = body;
      setSaveError(null);
      setStatus(draftRef.current === body ? "saved" : "saving");
    } catch (err) {
      setStatus("error");
      setSaveError(friendlyError(err));
      // A busy server or a dropped connection is worth another try; a 4xx would just fail again.
      if (err instanceof ApiError && (err.status === 429 || err.status === 0 || err.status >= 500)) {
        timer.current = setTimeout(() => void flush(), RETRY_DELAY_MS);
      }
    } finally {
      inFlight.current = false;
      if (rearm.current) {
        rearm.current = false;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
      }
    }
  }, []);

  const setText = useCallback(
    (value: string) => {
      draftRef.current = value;
      setDraft(value);
      setStatus("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush]
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush(true);
    };
    const onPageHide = () => void flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      void flush(true); // leaving the dashboard inside the app
    };
  }, [flush]);

  const text = draft ?? data?.text ?? "";
  return {
    text,
    setText,
    words: countWords(text),
    status,
    saveError,
    loaded: data !== undefined,
    loadError: error,
    retryLoad: () => mutate(),
  };
}
