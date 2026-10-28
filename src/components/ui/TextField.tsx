import type { InputHTMLAttributes } from "react";

/**
 * A labelled text input with optional help text and an inline error. The label is tied to the
 * input, and the help and error are tied to it through aria-describedby, so a screen reader reads
 * them together with the field. `id` must be unique on the page.
 */
export function TextField({
  id,
  label,
  error,
  help,
  ...input
}: { id: string; label: string; error?: string | null; help?: string } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "className"
>) {
  const describedBy = [help && `${id}-help`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        {...input}
        id={id}
        className={error ? "input is-invalid" : "input"}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {help && (
        <span className="help" id={`${id}-help`}>
          {help}
        </span>
      )}
      {error && (
        <div className="field-err" id={`${id}-err`}>
          {error}
        </div>
      )}
    </div>
  );
}
