"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { t } from "@/i18n/en";

const MIN_PASSWORD = 10;
const field = "mt-1 block w-full min-h-target rounded-md border border-border-strong bg-surface px-3 py-2";
const button = "inline-flex min-h-target w-full items-center justify-center rounded-md bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover";

type Errors = Partial<Record<"email" | "password" | "displayName" | "handle", string>>;

function PasswordField({ id, autoComplete, error, hint }: { id: string; autoComplete: string; error?: string; hint?: string }) {
  const [shown, setShown] = useState(false);
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="font-medium">{t("auth.password")}</label>
      {hint && <p id={`${id}-hint`} className="text-sm text-text-muted">{hint}</p>}
      <div className="flex gap-2">
        <input id={id} name="password" type={shown ? "text" : "password"} autoComplete={autoComplete} className={field}
          aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
        <button type="button" aria-pressed={shown} onClick={() => setShown((s) => !s)}
          className="mt-1 min-h-target min-w-target rounded-md border border-border-strong px-3 underline">
          {shown ? t("auth.password.hide") : t("auth.password.show")}
        </button>
      </div>
      {error && <p id={`${id}-error`} className="mt-1 text-danger">⚠ {error}</p>}
    </div>
  );
}

function TextField({ id, name, label, type = "text", autoComplete, error, hint }: {
  id: string; name: string; label: string; type?: string; autoComplete: string; error?: string; hint?: string;
}) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="font-medium">{label}</label>
      {hint && <p id={`${id}-hint`} className="text-sm text-text-muted">{hint}</p>}
      <input id={id} name={name} type={type} autoComplete={autoComplete} className={field}
        autoCapitalize="none" spellCheck={false}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
      {error && <p id={`${id}-error`} className="mt-1 text-danger">⚠ {error}</p>}
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function signInWithCredentials(email: string, password: string): Promise<"ok" | "invalid" | "throttled" | "error"> {
  const csrf = await fetch("/api/auth/csrf");
  if (!csrf.ok) return "error";
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const res = await fetch("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
  });
  if (res.status === 429) return "throttled";
  if (res.status >= 500) return "error";
  const session = (await (await fetch("/api/auth/session")).json().catch(() => null)) as { user?: { id?: string } } | null;
  return session?.user?.id ? "ok" : "invalid";
}

function retryAfter(res: Response): number | null {
  const n = Number(res.headers.get("Retry-After"));
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

function useAuthState() {
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const focusSummary = () => queueMicrotask(() => summaryRef.current?.focus());
  return { errors, setErrors, formError, setFormError, busy, setBusy, summaryRef, focusSummary };
}

function Summary({ s }: { s: ReturnType<typeof useAuthState> }) {
  const msgs = Object.values(s.errors);
  return (
    <div ref={s.summaryRef} tabIndex={-1} className="focus:outline-none">
      {s.formError && <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-danger">{s.formError}</p>}
      {msgs.length > 0 && (
        <div role="alert" className="rounded-md border border-danger bg-danger-bg p-3">
          <p className="font-semibold">{t("auth.errorSummary")}</p>
          <ul className="list-disc pl-5">{msgs.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const s = useAuthState();

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (s.busy) return;
    const fd = new FormData(ev.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const errs: Errors = {};
    if (!EMAIL_RE.test(email)) errs.email = t("auth.err.email");
    if (!password) errs.password = t("auth.err.passwordRequired");
    s.setErrors(errs);
    s.setFormError(null);
    if (Object.keys(errs).length) return s.focusSummary();
    s.setBusy(true);
    try {
      const r = await signInWithCredentials(email, password);
      if (r === "ok") { window.location.assign(callbackUrl); return; } // full load so the new session cookie is used
      s.setFormError(r === "invalid" ? t("login.error.invalid") : r === "throttled" ? t("login.error.throttledNoTime") : t("login.error.generic"));
    } catch {
      s.setFormError(t("login.error.generic"));
    }
    s.setBusy(false);
    s.focusSummary();
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={s.busy} className="mt-6 space-y-4">
      <Summary s={s} />
      <TextField id="email" name="email" label={t("auth.email")} type="email" autoComplete="username" error={s.errors.email} />
      <PasswordField id="password" autoComplete="current-password" error={s.errors.password} />
      <button type="submit" className={button} aria-disabled={s.busy}>{s.busy ? t("login.submitting") : t("login.submit")}</button>
      <p>{t("login.newHere")}{" "}
        <Link className="text-link underline" href={callbackUrl === "/" ? "/register" : `/register?callbackUrl=${encodeURIComponent(callbackUrl)}`}>{t("login.createAccount")}</Link>
      </p>
    </form>
  );
}

export function RegisterForm({ callbackUrl }: { callbackUrl: string }) {
  const s = useAuthState();
  const [sent, setSent] = useState(false);

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (s.busy) return;
    const fd = new FormData(ev.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const displayName = String(fd.get("displayName") ?? "").trim();
    const handle = String(fd.get("handle") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const errs: Errors = {};
    if (!EMAIL_RE.test(email) || email.length > 254) errs.email = t("auth.err.email");
    if (!displayName || displayName.length > 64) errs.displayName = t("auth.err.displayName");
    if (!/^[a-z0-9_]{3,32}$/.test(handle)) errs.handle = t("auth.err.handle");
    if (password.length < MIN_PASSWORD || password.length > 128) errs.password = t("auth.err.passwordMin", { min: MIN_PASSWORD });
    s.setErrors(errs);
    s.setFormError(null);
    if (Object.keys(errs).length) return s.focusSummary();
    s.setBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, handle, displayName }),
      });
      if (res.status === 429) {
        const secs = retryAfter(res);
        s.setFormError(secs ? t("login.error.throttled", { seconds: secs }) : t("register.error.throttled"));
      } else if (res.status === 202) {
        setSent(true); // identical for new and existing emails (SEC-05); no automatic sign-in
        return;
      } else if (res.status === 409 || res.status === 400) {
        s.setFormError(t("register.error.failed")); // generic: never reveals which field collided
      } else {
        s.setFormError(t("register.error.generic"));
      }
    } catch {
      s.setFormError(t("register.error.generic"));
    }
    s.setBusy(false);
    s.focusSummary();
  }

  if (sent) {
    return (
      <div className="mt-6 space-y-4">
        <p role="status">{t("register.sent")}</p>
        <Link className="text-link underline" href={callbackUrl === "/" ? "/login" : `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>{t("register.signIn")}</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={s.busy} className="mt-6 space-y-4">
      <Summary s={s} />
      <TextField id="email" name="email" label={t("auth.email")} type="email" autoComplete="email" error={s.errors.email} />
      <TextField id="displayName" name="displayName" label={t("auth.displayName")} autoComplete="name" error={s.errors.displayName} />
      <TextField id="handle" name="handle" label={t("auth.handle")} autoComplete="username" hint={t("auth.handle.hint")} error={s.errors.handle} />
      <PasswordField id="password" autoComplete="new-password" hint={t("auth.password.hint", { min: MIN_PASSWORD })} error={s.errors.password} />
      <button type="submit" className={button} aria-disabled={s.busy}>{s.busy ? t("register.submitting") : t("register.submit")}</button>
      <p>{t("register.haveAccount")}{" "}
        <Link className="text-link underline" href={callbackUrl === "/" ? "/login" : `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>{t("register.signIn")}</Link>
      </p>
    </form>
  );
}
