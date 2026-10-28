"use client";

import { type FormEvent, useState } from "react";
import { DeleteAccountDialog } from "@/components/settings/DeleteAccountDialog";
import { TextField } from "@/components/ui/TextField";
import { ApiError, MIN_PASSWORD_LENGTH, accountApi, friendlyError } from "@/lib/api";

type FieldErrors = { current?: string; next?: string; confirm?: string };

/** Account: change password and the danger zone (delete account). Log out is in the menu and the app bar. */
export function AccountSection() {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <PasswordForm />

      <section className="tile set-card set-danger" aria-labelledby="set-danger-h">
        <h2 id="set-danger-h">Delete account</h2>
        <p className="set-muted">
          This permanently removes your account, notes and room memberships. It can&apos;t be undone.
        </p>
        <div>
          <button className="btn btn-warn" type="button" onClick={() => setDeleteOpen(true)}>
            Delete account
          </button>
        </div>
      </section>

      {deleteOpen && <DeleteAccountDialog onClose={() => setDeleteOpen(false)} />}
    </>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const clearError = (field: keyof FieldErrors) => errors[field] && setErrors((s) => ({ ...s, [field]: undefined }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setDone(null);
    setFormError(null);

    const found: FieldErrors = {
      current: !current ? "Enter your current password" : undefined,
      next:
        next.length < MIN_PASSWORD_LENGTH
          ? `Use at least ${MIN_PASSWORD_LENGTH} characters`
          : next === current
            ? "Choose a password that is different from your current one"
            : undefined,
      confirm: confirm !== next ? "The two passwords don't match" : undefined,
    };
    setErrors(found);
    const firstInvalid = found.current ? "pw-current" : found.next ? "pw-new" : found.confirm ? "pw-confirm" : null;
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    setSaving(true);
    try {
      await accountApi.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone("Password updated. Your other devices were signed out; this one stays signed in.");
    } catch (err) {
      // A wrong current password is a 403, not a 401: it is a field error and never signs you out.
      if (err instanceof ApiError && err.status === 403) {
        setErrors({ current: "That password is incorrect." });
        document.getElementById("pw-current")?.focus();
      } else if (err instanceof ApiError && err.status === 400) {
        setErrors({ next: err.message });
        document.getElementById("pw-new")?.focus();
      } else if (err instanceof ApiError && err.status === 401) {
        setFormError("You've been signed out. Sign in again to change your password.");
      } else {
        setFormError(friendlyError(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="tile set-card" noValidate onSubmit={handleSubmit} aria-labelledby="set-pw-h">
      <h2 id="set-pw-h">Password</h2>
      {formError && (
        <p className="form-err" role="alert">
          {formError}
        </p>
      )}
      <TextField
        id="pw-current"
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        error={errors.current}
        onChange={(e) => {
          setCurrent(e.target.value);
          clearError("current");
        }}
      />
      <TextField
        id="pw-new"
        label="New password"
        type="password"
        autoComplete="new-password"
        value={next}
        error={errors.next}
        help={`At least ${MIN_PASSWORD_LENGTH} characters. Your other devices will be signed out.`}
        onChange={(e) => {
          setNext(e.target.value);
          clearError("next");
        }}
      />
      <TextField
        id="pw-confirm"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        error={errors.confirm}
        onChange={(e) => {
          setConfirm(e.target.value);
          clearError("confirm");
        }}
      />
      <div className="set-actions">
        <button className="btn btn-secondary" type="submit" aria-disabled={saving || undefined}>
          {saving ? "Updating…" : "Update password"}
        </button>
        {/* Always in the page, so the message is announced when its text appears. */}
        <p className="set-saved" role="status">
          {done}
        </p>
      </div>
    </form>
  );
}
