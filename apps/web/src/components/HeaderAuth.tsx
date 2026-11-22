"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { t } from "@/i18n/en";
import { Avatar } from "./ui/Avatar";

type State = { kind: "loading" } | { kind: "out" } | { kind: "in"; name: string; handle: string | null };

const ghost = "inline-flex min-h-target items-center rounded-md px-3 font-medium hover:bg-bg-subtle";
const primary = "inline-flex min-h-target items-center rounded-md bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover";

/** Session-aware actions. Fetches the public NextAuth session endpoint (no secrets); errors degrade to signed-out. Fixed-height slot, so no layout shift. */
export function HeaderAuth() {
  const [s, setS] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((b: { user?: { id?: string; name?: string | null; email?: string | null; handle?: string | null } }) => {
        if (!live) return;
        setS(b?.user?.id ? { kind: "in", name: b.user.name ?? b.user.email ?? "Me", handle: b.user.handle ?? null } : { kind: "out" });
      })
      .catch(() => { if (live) setS({ kind: "out" }); });
    return () => { live = false; };
  }, []);
  if (s.kind === "loading") return <span aria-hidden="true" className="inline-block h-11 w-24" />;
  if (s.kind === "out") {
    return (
      <span className="flex items-center gap-1">
        <Link href="/login" className={ghost}>{t("nav.signIn")}</Link>
        <Link href="/register" className={primary}>{t("nav.register")}</Link>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Link href="/account/notifications" className={ghost}>{t("notif.h1")}</Link>
      <Link href="/account/profile" className="inline-flex min-h-target items-center gap-2 rounded-md px-2 hover:bg-bg-subtle">
        <Avatar name={s.name} size="sm" /><span className="hidden max-w-[10rem] truncate sm:inline">{s.name}</span>
        <span className="sr-only">{t("nav.account")}</span>
      </Link>
    </span>
  );
}
