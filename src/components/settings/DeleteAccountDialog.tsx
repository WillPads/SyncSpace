"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { TextField } from "@/components/ui/TextField";
import { useDialog } from "@/hooks/useDialog";
import { ApiError, accountApi, friendlyError } from "@/lib/api";

export const ACCOUNT_DELETED_PATH = "/signed-out?account=deleted";

/**
 * Confirm dialog for "Delete account". The password is required, and a wrong one (403) is shown
 * under the field: it must never sign you out or leave the page. On success the server has already
 * cleared the cookie, so we go to the logged-out screen, which drops the stale cached session.
 */
export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Esc and clicking outside would cancel a request in flight, so they are ignored while deleting.
  const close = () => {
    if (!deleting) onClose();
  };
  useDialog(formRef, close, "#del-pw");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleting) return;
    setFormError(null);
    if (!password) {
      setFieldError("Enter your password to confirm");
      document.getElementById("del-pw")?.focus();
      return;
    }
    setFieldError(null);
    setDeleting(true);
    try {
      await accountApi.deleteAccount(password);
      router.replace(ACCOUNT_DELETED_PATH); // stays "Deleting…" until the new page replaces this one
    } catch (err) {
      setDeleting(false);
      if (err instanceof ApiError && err.status === 403) {
        setFieldError("That password is incorrect.");
        document.getElementById("del-pw")?.focus();
      } else if (err instanceof ApiError && err.status === 401) {
        setFormError("You've been signed out already. Sign in again if you still want to delete your account.");
      } else {
        setFormError(friendlyError(err));
      }
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form
        ref={formRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="del-title"
        aria-describedby="del-desc"
        onSubmit={handleSubmit}
        noValidate
      >
        <span className="dialog-title" id="del-title">
          Delete your account?
        </span>
        <div id="del-desc" className="set-del-copy">
          <p>This can&apos;t be undone. Here is what happens:</p>
          <ul>
            <li>Your account, notes, quick note and quiz scores are deleted, and you leave every room.</li>
            <li>
              Rooms you host are handed to the member who has been there longest. A room with nobody else in it is
              deleted.
            </li>
            <li>Your chat messages and uploaded files stay in those rooms, shown as &quot;Deleted user&quot;.</li>
          </ul>
        </div>
        {formError && (
          <p className="form-err" role="alert">
            {formError}
          </p>
        )}
        <TextField
          id="del-pw"
          label="Your password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={fieldError}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldError) setFieldError(null);
          }}
        />
        <div className="dialog-actions">
          <button className="btn btn-secondary" type="button" aria-disabled={deleting || undefined} onClick={close}>
            Keep my account
          </button>
          <button className="btn btn-warn" type="submit" aria-disabled={deleting || undefined}>
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </form>
    </div>
  );
}
