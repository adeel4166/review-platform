"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t, type MessageKey } from "@/i18n/en";
import { api } from "@/lib/upload";
import { primaryBtn, secondaryBtn } from "./ui";

/**
 * One-click token pages (cancel-by-link, business-email confirm/deny). GET never consumes the token (mail scanners prefetch
 * links): the buttons POST it in the body. The token is read once and removed from the address bar.
 */
export function TokenAction({ urlToken, endpoint, denyEndpoint, labels, signInHref }: {
  urlToken: string; endpoint: string; denyEndpoint?: string; signInHref?: string;
  labels: { confirm: MessageKey; deny?: MessageKey; done: MessageKey; denied?: MessageKey; invalid: MessageKey };
}) {
  const [token, setToken] = useState(urlToken);
  const [state, setState] = useState<"idle" | "busy" | "done" | "denied" | "bad">("idle");
  // With a sign-in round-trip the token waits in sessionStorage, never in the callbackUrl (same rule as T-07 for invitations).
  const key = `rp.token.${endpoint}`;
  useEffect(() => {
    if (urlToken) {
      if (signInHref) { try { sessionStorage.setItem(key, urlToken); } catch { /* ignore */ } }
      window.history.replaceState(null, "", window.location.pathname);
    } else if (signInHref === undefined) {
      try { setToken(sessionStorage.getItem(key) ?? ""); } catch { /* ignore */ }
    }
  }, [urlToken, signInHref, key]);

  async function run(path: string, ok: "done" | "denied") {
    setState("busy");
    try { await api(path, { method: "POST", body: JSON.stringify({ token }) }); try { sessionStorage.removeItem(key); } catch { /* ignore */ } setState(ok); } catch { setState("bad"); }
  }
  if (state === "done" || state === "denied") return <p role="status" className="mt-6">{t(state === "done" ? labels.done : labels.denied ?? labels.done)}</p>;
  return (
    <div className="mt-6 space-y-4">
      {state === "bad" && <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-danger">{t(labels.invalid)}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!token || state === "busy"} onClick={() => void run(endpoint, "done")} className={primaryBtn}>{t(labels.confirm)}</button>
        {denyEndpoint && labels.deny && <button type="button" disabled={!token || state === "busy"} onClick={() => void run(denyEndpoint, "denied")} className={secondaryBtn}>{t(labels.deny)}</button>}
      </div>
      {signInHref && <p><Link className="text-link underline" href={signInHref}>{t("claimemail.signIn")}</Link></p>}
    </div>
  );
}
