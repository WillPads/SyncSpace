"use client";

import { Moon, Sun } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { useThemeMode } from "@/hooks/useThemeMode";

/**
 * Flips between dark and light and remembers the choice. It follows the OS until you pick a side
 * (the Settings screen can set it back to "System"). The state lives in hooks/useThemeMode.ts so
 * this button and the Settings screen always agree; the inline script in app/layout.tsx applies
 * the same logic before first paint so there's no flash.
 */
export function ThemeToggle() {
  const { dark, setMode } = useThemeMode();
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      className="btn btn-ghost btn-icon"
      type="button"
      title={label}
      aria-label={label}
      onClick={() => setMode(dark ? "light" : "dark")}
    >
      <Icon icon={dark ? Sun : Moon} size={18} />
    </button>
  );
}
