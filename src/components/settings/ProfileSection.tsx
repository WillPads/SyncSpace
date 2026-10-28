"use client";

import { type FormEvent, useState } from "react";
import { TextField } from "@/components/ui/TextField";
import { useSession } from "@/hooks/useSession";
import { ApiError, accountApi, friendlyError } from "@/lib/api";
import { initials } from "@/lib/avatar";
import type { User } from "@/lib/types";

const NAME_MAX = 40; // the server's limit for a display name
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

type FieldErrors = { name?: string; email?: string; password?: string };

/**
 * Profile: change your name and email. The name is saved on its own. A new email also needs the
 * current password (the server insists, because the email is how you sign in), so that field
 * only appears once the email box differs from the saved one.
 */
export function ProfileSection({ user }: { user: User }) {
  const { setUser } = useSession();
  const [name, setName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameChanged = name.trim() !== user.displayName;
  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();
  const dirty = nameChanged || emailChanged;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaved(null);
    setFormError(null);

    const found: FieldErrors = {
      name: !name.trim() ? "Enter your name" : name.trim().length > NAME_MAX ? `Use ${NAME_MAX} characters or fewer` : undefined,
      email: emailChanged && !EMAIL_PATTERN.test(email.trim()) ? "Enter a valid email address" : undefined,
      password: emailChanged && !password ? "Enter your current password to change your email" : undefined,
    };
    setErrors(found);
    const firstInvalid = found.name ? "set-name" : found.email ? "set-email" : found.password ? "set-email-pw" : null;
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    if (!dirty) return setSaved("Nothing has changed.");

    setSaving(true);
    try {
      const updated = await accountApi.updateProfile({
        ...(nameChanged && { displayName: name.trim() }),
        ...(emailChanged && { email: email.trim(), currentPassword: password }),
      });
      await setUser(updated); // the app bar, greeting and this screen all read the session
      setName(updated.displayName);
      setEmail(updated.email);
      setPassword("");
      setSaved(emailChanged ? "Saved. Use your new email the next time you sign in." : "Profile saved.");
    } catch (err) {
      // A wrong password is a 403, not a 401: it stays an inline field error and never signs you out.
      if (err instanceof ApiError && err.status === 403) {
        setErrors({ password: "That password is incorrect." });
        document.getElementById("set-email-pw")?.focus();
      } else if (err instanceof ApiError && err.status === 409) {
        setErrors({ email: "That email is already used by another account." });
        document.getElementById("set-email")?.focus();
      } else if (err instanceof ApiError && err.status === 401) {
        setFormError("You've been signed out. Sign in again to change your profile.");
      } else {
        setFormError(friendlyError(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="tile tile-tint set-id">
        <span className="avatar avatar-lg" aria-hidden="true">
          {initials(user.displayName)}
        </span>
        <div className="set-id-text">
          <p className="set-id-name">{user.displayName}</p>
          <p className="help">Your initials appear next to your name in rooms.</p>
        </div>
      </div>

      <form className="tile set-card set-wide" noValidate onSubmit={handleSubmit} aria-label="Edit profile">
        {formError && (
          <p className="form-err" role="alert">
            {formError}
          </p>
        )}
        <div className="set-two">
          <TextField
            id="set-name"
            label="Full name"
            autoComplete="name"
            maxLength={NAME_MAX}
            value={name}
            error={errors.name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(null);
              if (errors.name) setErrors((s) => ({ ...s, name: undefined }));
            }}
          />
          <TextField
            id="set-email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            error={errors.email}
            help="Changing your email asks for your current password."
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved(null);
              if (errors.email) setErrors((s) => ({ ...s, email: undefined }));
            }}
          />
        </div>
        {emailChanged && (
          <TextField
            id="set-email-pw"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={password}
            error={errors.password}
            help="We ask once, to make sure it's really you."
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors((s) => ({ ...s, password: undefined }));
            }}
          />
        )}
        <div className="set-actions">
          <button className="btn btn-primary" type="submit" aria-disabled={!dirty || saving || undefined}>
            {saving ? "Saving…" : "Save profile"}
          </button>
          {/* Always in the page, so the message is announced when its text appears. */}
          <p className="set-saved" role="status">
            {saved}
          </p>
        </div>
      </form>
    </>
  );
}
