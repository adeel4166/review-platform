"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { t } from "@/i18n/en";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => { h.current?.focus(); }, []);
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div role="alert" className="rounded-lg border border-border bg-surface p-6">
        <h1 ref={h} tabIndex={-1} className="text-2xl font-semibold">{t("state.error.title")}</h1>
        <p className="mt-2 text-text-muted">{t("state.error.body")}</p>
        {error.digest && <p className="mt-2 font-mono text-sm text-text-muted">{error.digest}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={reset} className="min-h-target rounded-md bg-primary px-4 font-semibold text-on-primary">{t("state.error.retry")}</button>
          <Link href="/" className="inline-flex min-h-target items-center rounded-md border border-border-strong px-4">{t("state.error.home")}</Link>
        </div>
      </div>
    </main>
  );
}
