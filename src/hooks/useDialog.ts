"use client";

import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE =
  "a[href], button:not(:disabled):not([aria-disabled='true']), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)";

/**
 * Modal-dialog keyboard behaviour in one place: focus moves into the dialog when it opens, Tab and
 * Shift+Tab stay inside it, Escape closes it, and focus goes back to the button that opened it.
 * `initialFocus` is a selector for the element that should get focus first (default: the first
 * focusable one). `onClose` is kept in a ref so a parent re-render doesn't re-run the focus move.
 */
export function useDialog(container: RefObject<HTMLElement | null>, onClose: () => void, initialFocus?: string) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = container.current;
    const start = (initialFocus ? root?.querySelector<HTMLElement>(initialFocus) : null) ?? root?.querySelector<HTMLElement>(FOCUSABLE);
    start?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return closeRef.current();
      if (event.key !== "Tab" || !container.current) return;
      const items = Array.from(container.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [container, initialFocus]);
}
