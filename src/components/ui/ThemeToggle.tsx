"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { loadStored, saveStored } from "@/lib/storage";

type Mode = "system" | "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function resolveDark(mode: Mode): boolean {
  return mode === "dark" || (mode === "system" && window.matchMedia(DARK_QUERY).matches);
}

function applyTheme(dark: boolean) {
  // Forest is the dark theme, Mist the light one (styles/theme.css).
  document.documentElement.setAttribute("data-theme", dark ? "forest" : "mist");
}

/**
 * Follows the OS until the user picks a side; the choice then sticks. The inline script in
 * app/layout.tsx applies the same logic before first paint so there's no flash.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = loadStored<Mode>("mode", "system");
    setMode(stored);
    setDark(resolveDark(stored));
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setDark(event.matches);
      applyTheme(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  function toggle() {
    const nextDark = !(dark ?? true);
    const nextMode: Mode = nextDark ? "dark" : "light";
    saveStored("mode", nextMode);
    setMode(nextMode);
    setDark(nextDark);
    applyTheme(nextDark);
  }

  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button className="btn btn-ghost btn-icon" type="button" title={label} aria-label={label} onClick={toggle}>
      <Icon icon={dark ? Sun : Moon} size={18} />
    </button>
  );
}
