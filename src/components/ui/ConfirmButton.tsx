"use client";

import { type ReactNode, useEffect, useState } from "react";

/** First click arms it and shows `confirmLabel`; a second click within 3s runs the action. */
export function ConfirmButton({
  className,
  children,
  confirmLabel,
  label,
  disabled,
  onConfirm,
}: {
  className: string;
  children: ReactNode;
  confirmLabel: string;
  label: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      title={armed ? undefined : label}
      aria-label={armed ? confirmLabel : label}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
