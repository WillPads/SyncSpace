"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type InputHTMLAttributes, Suspense, useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/Brand";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useSession } from "@/hooks/useSession";
import { ApiError, errorMessage } from "@/lib/api";

type Mode = "signin" | "register";

const MIN_PASSWORD = 8;

// Only follow same-site paths, so ?next= can't bounce people to another site.
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}

function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { user, signIn, register } = useSession();

  // /login?mode=register opens on "Create account" (the deleted-account screen links here).
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : "signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  // True when the server said "wrong email or password" (code INVALID_CREDENTIALS). The message stays
  // generic on purpose so it never reveals whether an account exists; we only offer a way to sign up.
  const [badCredentials, setBadCredentials] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  function switchMode(to: Mode) {
    setMode(to);
    setErrors({});
    setFormError(null);
    setBadCredentials(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = {
      name: mode === "register" && !displayName.trim() ? "Enter your name" : undefined,
      email: /^\S+@\S+\.\S+$/.test(email.trim()) ? undefined : "Enter a valid email address",
      password:
        mode === "register" && password.length < MIN_PASSWORD
          ? `Password needs at least ${MIN_PASSWORD} characters`
          : !password
            ? "Enter your password"
            : undefined,
    };
    setErrors(found);
    setFormError(null);
    setBadCredentials(false);
    const firstInvalid = found.name ? "login-name" : found.email ? "login-email" : found.password ? "login-pw" : null;
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "register") await register(email.trim(), password, displayName.trim());
      else await signIn(email.trim(), password);
      // The effect above redirects once the session updates.
    } catch (err) {
      setFormError(errorMessage(err));
      setBadCredentials(mode === "signin" && err instanceof ApiError && err.code === "INVALID_CREDENTIALS");
      setSubmitting(false);
    }
  }

  const isRegister = mode === "register";

  return (
    <div className="redesign app-screen auth-screen">
      <header className="auth-bar">
        <Link href="/" className="brand-btn">
          <BrandMark />
          SyncSpace
        </Link>
        <ThemeToggle />
      </header>

      <main className="auth-main">
        <section className="tile auth-card" aria-labelledby="login-title">
          <div className="seg" role="group" aria-label="Account">
            <button type="button" aria-pressed={isRegister} onClick={() => switchMode("register")}>
              Create account
            </button>
            <button type="button" aria-pressed={!isRegister} onClick={() => switchMode("signin")}>
              Sign in
            </button>
          </div>
          <div>
            <h2 id="login-title">{isRegister ? "Create your account" : "Welcome back"}</h2>
            <p className="auth-sub">
              {isRegister ? "Free for students. No card needed." : "Sign in to see your rooms and notes."}
            </p>
          </div>

          <form className="auth-form" noValidate onSubmit={handleSubmit}>
            {formError && (
              <div className="form-err" role="alert">
                <p>{formError}</p>
                {badCredentials && (
                  <p className="form-err-next">
                    No account yet?{" "}
                    <button
                      className="link-btn"
                      type="button"
                      onClick={() => {
                        switchMode("register");
                        // The button disappears with the error, so hand focus to the next thing to fill in.
                        requestAnimationFrame(() => document.getElementById("login-name")?.focus());
                      }}
                    >
                      Create an account
                    </button>
                  </p>
                )}
              </div>
            )}

            {isRegister && (
              <Field
                id="login-name"
                label="Full name"
                error={errors.name}
                input={{
                  autoComplete: "name",
                  placeholder: "How the room will see you",
                  maxLength: 40,
                  value: displayName,
                  onChange: (e) => {
                    setDisplayName(e.target.value);
                    if (errors.name) setErrors((s) => ({ ...s, name: undefined }));
                  },
                }}
              />
            )}
            <Field
              id="login-email"
              label="Email"
              error={errors.email}
              input={{
                type: "email",
                autoComplete: "email",
                placeholder: "you@example.com",
                value: email,
                onChange: (e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors((s) => ({ ...s, email: undefined }));
                },
              }}
            />
            <Field
              id="login-pw"
              label="Password"
              error={errors.password}
              help={isRegister ? `At least ${MIN_PASSWORD} characters.` : undefined}
              input={{
                type: "password",
                autoComplete: isRegister ? "new-password" : "current-password",
                value: password,
                onChange: (e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors((s) => ({ ...s, password: undefined }));
                },
              }}
            />

            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={submitting}>
              {submitting ? (isRegister ? "Creating account…" : "Signing in…") : isRegister ? "Create account" : "Sign in"}
            </button>
            <div className="login-links">
              {isRegister ? (
                <>
                  <span className="help">Already have an account?</span>
                  <button className="link-btn" type="button" onClick={() => switchMode("signin")}>
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  <span className="help">New to SyncSpace?</span>
                  <button className="link-btn" type="button" onClick={() => switchMode("register")}>
                    Create account
                  </button>
                </>
              )}
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  help,
  input,
}: {
  id: string;
  label: string;
  error?: string;
  help?: string;
  input: InputHTMLAttributes<HTMLInputElement>;
}) {
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
