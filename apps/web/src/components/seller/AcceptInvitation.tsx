"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { primaryBtn } from "./ui";

/** GET never consumes the token (mail scanners prefetch links): the button POSTs it. The token is not logged or stored. */
const STORE_KEY = "rp.invite";

/**
 * T-07: the invitation token never travels in a login callbackUrl (those land in logs, history and Referer). It is kept in
 * sessionStorage for the sign-in round-trip, and removed from the address bar as soon as the page has read it.
 */
export function AcceptInvitation({ token: urlToken, signedIn }: { token: string; signedIn: boolean }) {
  const [token, setToken] = useState(urlToken);
  useEffect(() => {
    if (urlToken) {
      try { sessionStorage.setItem(STORE_KEY, urlToken); } catch { /* private mode: the link still works while signed in */ }
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    try { setToken(sessionStorage.getItem(STORE_KEY) ?? ""); } catch { /* no stored token */ }
  }, [urlToken]);
  const [state, setState] = useState<"idle" | "busy" | "bad" | "verify">("idle");
  const [done, setDone] = useState<{ sellerId: string } | null>(null);

  if (!signedIn) {
    return <Link className="mt-6 inline-flex min-h-target items-center text-link underline" href={`/login?callbackUrl=${encodeURIComponent("/invitations/accept")}`}>{t("invite.signIn")}</Link>;
  }
  if (done) {
    return (
      <div className="mt-6" role="status">
        <p>{t("invite.done")}</p>
        <Link className="mt-3 inline-flex min-h-target items-center text-link underline" href={`/seller/${done.sellerId}`}>{t("invite.open")}</Link>
      </div>
    );
  }
  async function accept() {
    setState("busy");
    try {
      setDone(await api<{ sellerId: string }>("/api/invitations/accept", { method: "POST", body: JSON.stringify({ token }) }));
      try { sessionStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    } catch (e) {
      setState(e instanceof ApiError && e.code === "EMAIL_NOT_VERIFIED" ? "verify" : "bad");
    }
  }
  return (
    <div className="mt-6 space-y-4">
      {state === "bad" && <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-danger">{t("invite.invalid")}</p>}
      {state === "verify" && <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-danger">{t("invite.verifyFirst")}</p>}
      <button type="button" onClick={accept} disabled={!token || state === "busy"} className={`${primaryBtn} w-full`}>{t("invite.accept")}</button>
    </div>
  );
}
