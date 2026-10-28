"use client";

import { Check, Moon, Monitor, Sun, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { useBackgroundMotion } from "@/hooks/useBackgroundMotion";
import { type ThemeMode, useThemeMode } from "@/hooks/useThemeMode";

const THEMES: { value: ThemeMode; label: string; text: string; icon: LucideIcon }[] = [
  { value: "dark", label: "Dark", text: "Dark green, easy on the eyes.", icon: Moon },
  { value: "light", label: "Light", text: "Light surfaces for bright rooms.", icon: Sun },
  { value: "system", label: "System", text: "Match your device.", icon: Monitor },
];

/**
 * Appearance: theme and background animation. Both are saved in this browser only (localStorage),
 * not on your account, and the app-bar theme button reads the same value.
 */
export function AppearanceSection() {
  const { mode, setMode } = useThemeMode();
  const { animated, reduced, setChoice } = useBackgroundMotion();

  return (
    <>
      <section className="tile set-card set-wide" aria-labelledby="set-theme-h">
        <h2 id="set-theme-h">Theme</h2>
        <div className="opt-cards" role="radiogroup" aria-labelledby="set-theme-h">
          {THEMES.map((theme) => (
            <label className="opt-card" key={theme.value}>
              <input
                type="radio"
                name="theme"
                value={theme.value}
                checked={mode === theme.value}
                onChange={() => setMode(theme.value)}
              />
              <span className="opt-h">
                <Icon icon={theme.icon} size={18} />
                {theme.label}
                <span className="opt-tick" aria-hidden="true">
                  <Icon icon={Check} size={16} />
                </span>
              </span>
              <span className="opt-d">{theme.text}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="tile set-card set-wide" aria-labelledby="set-motion-h">
        <h2 id="set-motion-h">Motion</h2>
        <div className="set-row">
          <div>
            <div className="set-row-title" id="set-fx-label">
              Background animation
            </div>
            <p className="help" id="set-fx-help">
              {reduced
                ? "Your device is set to reduce motion, so the background stays still."
                : "Slow-moving rings behind each page. Turn off for a still background."}
            </p>
          </div>
          <button
            className="set-switch"
            type="button"
            role="switch"
            aria-checked={animated}
            aria-disabled={reduced || undefined}
            aria-labelledby="set-fx-label"
            aria-describedby="set-fx-help"
            onClick={() => {
              if (!reduced) setChoice(!animated);
            }}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </section>
    </>
  );
}
