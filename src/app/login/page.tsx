"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type InputHTMLAttributes, Suspense, useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/Brand";
import { Corners } from "@/components/ui/Corners";
import { useSession } from "@/hooks/useSession";
import { errorMessage } from "@/lib/api";

type Mode = "signin" | "register";

const MIN_PASSWORD = 8;

const PANEL_ROWS = [
  { n: "01", title: "Open a room", sub: "Choose focus and break lengths" },
  { n: "02", title: "Share the code", sub: "Everyone joins the same clock" },
  { n: "03", title: "Quiz at the end", sub: "Built from the notes you upload" },
];

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
  const next = safeNext(useSearchParams().get("next"));
  const { user, signIn, register } = useSession();

  const [mode, setMode] = useState<Mode>("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  function switchMode(to: Mode) {
    setMode(to);
    setErrors({});
    setFormError(null);
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
      setSubmitting(false);
    }
  }

  const isRegister = mode === "register";

  return (
    <div className="login">
      <div className="login-main">
        <Link href="/" className="brand-btn">
          <BrandMark />
          SyncSpace
        </Link>
        <form className="login-card blueprint" noValidate onSubmit={handleSubmit}>
          <Corners />
          <div>
            <h2>{isRegister ? "Create account" : "Sign in"}</h2>
            <p className="sub">
              {isRegister ? "One account for every room you join." : "Your rooms and rounds are waiting."}
            </p>
          </div>

          {formError && (
            <p className="form-err" role="alert">
              {formError}
            </p>
          )}

          {isRegister && (
            <Field
              id="login-name"
              label="Your name"
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
              placeholder: "you@school.edu",
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
            input={{
              type: "password",
              autoComplete: isRegister ? "new-password" : "current-password",
              placeholder: isRegister ? `At least ${MIN_PASSWORD} characters` : undefined,
              value: password,
              onChange: (e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((s) => ({ ...s, password: undefined }));
              },
            }}
          />

          <button className="btn btn-primary btn-block blueprint" type="submit" disabled={submitting}>
            <Corners />
            {submitting ? (isRegister ? "Creating account…" : "Signing in…") : isRegister ? "Create account" : "Sign in"}
          </button>
          <div className="login-links">
            {isRegister ? (
              <>
                <span className="muted">Already have an account?</span>
                <button className="link-btn" type="button" onClick={() => switchMode("signin")}>
                  Sign in
                </button>
              </>
            ) : (
              <>
                <span className="muted">New to SyncSpace?</span>
                <button className="link-btn" type="button" onClick={() => switchMode("register")}>
                  Create account
                </button>
              </>
            )}
          </div>
        </form>
      </div>
      <div className="login-panel">
        <span className="panel-kicker">How a room works</span>
        {PANEL_ROWS.map((row) => (
          <div className="panel-row" key={row.n}>
            <span className="panel-clock">{row.n}</span>
            <span className="panel-name">
              <b>{row.title}</b>
              <span>{row.sub}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  input,
}: {
  id: string;
  label: string;
  error?: string;
  input: InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        {...input}
        id={id}
        className={error ? "input is-invalid" : "input"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      {error && (
        <div className="field-err" id={`${id}-err`}>
          {error}
        </div>
      )}
    </div>
  );
}
