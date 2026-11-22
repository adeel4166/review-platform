"use client";

import { useState, type FormEvent } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { Dialog } from "../Dialog";
import { field, secondaryBtn } from "../seller/ui";
import { StepUpFields, stepUp } from "./StepUpFields";

export const ERASE_DANGER_BTN = "inline-flex min-h-target items-center justify-center rounded-md bg-danger px-4 py-2 font-semibold text-white hover:bg-danger/90 disabled:opacity-60";
/** The typed confirmation must equal the handle exactly (the API enforces the same, 422 confirmation_mismatch). */
export const eraseConfirmed = (typed: string, handle: string) => typed.trim() === handle;
/** Maps an API error to an i18n key; unknown codes fall back to the generic message. */
export const eraseErrorKey = (e: unknown): MessageKey => {
  const code = e instanceof ApiError ? e.code : "error";
  return (["confirmation_mismatch", "last_owner", "invalid_credentials"].includes(code) ? `erase.err.${code}` : "erase.err.error") as MessageKey;
};

async function signOut(): Promise<void> {
  try {
    const { csrfToken } = (await (await fetch("/api/auth/csrf")).json()) as { csrfToken: string };
    await fetch("/api/auth/signout", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken, json: "true" }) });
  } catch { /* the server already revoked the sessions; the redirect below lands signed out either way */ }
}

/** Danger zone: re-auth (password + optional 2FA code) + typed handle -> DELETE /api/account -> sign out -> redirect (DEF-LIVE-08). */
export function AccountErasure({ handle, redirectTo = "/", navigate = (u: string) => window.location.assign(u) }: { handle: string; redirectTo?: string; navigate?: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!eraseConfirmed(typed, handle)) { setErr("erase.err.confirmation_mismatch"); return; }
    const fd = new FormData(e.currentTarget);
    setBusy(true); setErr(null);
    try {
      await stepUp(String(fd.get("stepUpPassword") ?? ""), String(fd.get("stepUpCode") ?? "") || undefined);
      await api("/api/account", { method: "DELETE", body: JSON.stringify({ confirm: typed.trim() }) });
      setDone(true);
      await signOut();
      navigate(redirectTo);
    } catch (x) { setErr(eraseErrorKey(x)); setBusy(false); }
  }

  return (
    <section aria-labelledby="erase-h" className="mt-10 rounded-md border border-danger p-4">
      <h2 id="erase-h" className="text-xl font-semibold">{t("erase.h2")}</h2>
      <p className="mt-2 max-w-reading">{t("erase.explain")}</p>
      <button type="button" className={`${ERASE_DANGER_BTN} mt-3`} onClick={() => { setOpen(true); setTyped(""); setErr(null); }}>{t("erase.open")}</button>
      {open && (
        <Dialog titleId="erase-title" title={t("erase.dialog.title")} onClose={() => { if (!busy) setOpen(false); }}>
          <form onSubmit={submit} className="mt-3 space-y-3">
            <p>{t("erase.explain")}</p>
            <div>
              <label htmlFor="erase-confirm" className="font-medium">{t("erase.confirm.label", { handle })}</label>
              <input id="erase-confirm" data-autofocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} required className={field} />
            </div>
            <p className="text-sm">{t("erase.stepUp")}</p>
            <StepUpFields idPrefix="erase" />
            <div>
              <label htmlFor="erase-code" className="font-medium">{t("erase.code.label")}</label>
              <input id="erase-code" name="stepUpCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className={field} />
            </div>
            <p role="alert" className="min-h-[1.5rem] text-danger">{err ? t(err) : ""}</p>
            {done && <p role="status">{t("erase.done")}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !eraseConfirmed(typed, handle)} className={ERASE_DANGER_BTN}>{t("erase.submit")}</button>
              <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setOpen(false)}>{t("erase.cancel")}</button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
