"use client";

import { useCallback, useSyncExternalStore } from "react";
import { loadStored, saveStored } from "@/lib/storage";

const KEY = "fx"; // stored as "syncspace.fx" (true / false); the pre-paint script in app/layout.tsx reads it too
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
const listeners = new Set<() => void>();

/** What the person chose. No saved choice means "on". */
function readChoice(): boolean {
  return loadStored<boolean>(KEY, true) !== false;
}

function applyChoice(on: boolean) {
  // base.css only animates the backdrop rings when <html> does not carry data-fx="off".
  if (on) document.documentElement.removeAttribute("data-fx");
  else document.documentElement.setAttribute("data-fx", "off");
}

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const query = window.matchMedia(REDUCE_QUERY);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== `syncspace.${KEY}`) return;
    applyChoice(readChoice());
    notify();
  };
  query.addEventListener("change", listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    query.removeEventListener("change", listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The "Background animation" setting. `reduced` is the operating-system "reduce motion"
 * preference: while it is on, the backdrop never moves (base.css enforces that in CSS) and the
 * switch is locked to off, so the setting can't claim something the page won't do.
 * `animated` is what the screen is actually doing right now.
 */
export function useBackgroundMotion() {
  const choice = useSyncExternalStore(subscribe, readChoice, () => true);
  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCE_QUERY).matches,
    () => false
  );

  const setChoice = useCallback((on: boolean) => {
    saveStored(KEY, on);
    applyChoice(on);
    notify();
  }, []);

  return { animated: choice && !reduced, reduced, setChoice };
}
