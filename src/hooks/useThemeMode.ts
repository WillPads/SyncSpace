"use client";

import { useCallback, useSyncExternalStore } from "react";
import { loadStored, saveStored } from "@/lib/storage";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "mode"; // stored as "syncspace.mode"; the pre-paint script in app/layout.tsx reads the same key
const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function readMode(): ThemeMode {
  const stored = loadStored<ThemeMode>(KEY, "system");
  return stored === "dark" || stored === "light" ? stored : "system";
}

function isDark(mode: ThemeMode): boolean {
  return mode === "dark" || (mode === "system" && window.matchMedia(DARK_QUERY).matches);
}

function applyTheme(dark: boolean) {
  // Forest is the dark theme, Mist the light one (styles/theme.css).
  document.documentElement.setAttribute("data-theme", dark ? "forest" : "mist");
}

function notify() {
  listeners.forEach((listener) => listener());
}

/**
 * Subscribing also keeps the page in step with the outside world: when the OS flips between
 * light and dark while the mode is "system", and when another tab changes the stored mode.
 */
function subscribe(listener: () => void) {
  listeners.add(listener);
  const query = window.matchMedia(DARK_QUERY);
  const onSystemChange = () => {
    if (readMode() !== "system") return;
    applyTheme(query.matches);
    notify();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== `syncspace.${KEY}`) return;
    applyTheme(isDark(readMode()));
    notify();
  };
  query.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    query.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The theme setting, shared by the app-bar toggle and the Settings screen. Both read the same
 * localStorage value through useSyncExternalStore, so changing it in one place updates the
 * other straight away. The server snapshots ("system" / dark) match the default data-theme in
 * app/layout.tsx; the inline script there fixes the real theme before first paint.
 */
export function useThemeMode() {
  const mode = useSyncExternalStore(subscribe, readMode, () => "system" as ThemeMode);
  const dark = useSyncExternalStore(
    subscribe,
    () => isDark(readMode()),
    () => true
  );

  const setMode = useCallback((next: ThemeMode) => {
    saveStored(KEY, next);
    applyTheme(isDark(next));
    notify();
  }, []);

  return { mode, dark, setMode };
}
