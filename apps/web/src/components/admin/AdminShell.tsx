"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { t, type MessageKey } from "@/i18n/en";
import { Badge } from "@/components/ui/Badge";

export const STAFF_LINKS: readonly (readonly [string, MessageKey])[] = [
  ["/admin/moderation", "staff.nav.moderation"], ["/admin/media", "staff.nav.media"], ["/admin/proofs", "staff.nav.proofs"],
  ["/admin/approvals", "staff.nav.approvals"], ["/admin/appeals", "staff.nav.appeals"], ["/admin/seller-claims", "staff.nav.claims"],
  ["/admin/enforcement", "staff.nav.enforcement"],
];

/** Staff shell: rail ≥lg, horizontally scrolling segmented list below. Navigation only; every page and API enforces roles itself. */
export function AdminShellView({ pathname, children }: { pathname: string; children: ReactNode }) {
  return (
    <div className="bg-bg-subtle">
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[90rem] items-center gap-3 px-4 py-2">
          <Badge variant="staff">{t("staff.badge")}</Badge>
          <p className="text-sm text-text-muted">{t("staff.server.note")}</p>
        </div>
      </div>
      <div className="mx-auto flex max-w-[90rem] flex-col lg:flex-row">
        <nav aria-label={t("staff.nav.label")} className="border-b border-border bg-surface lg:min-h-[calc(100vh-8rem)] lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
          <ul className="flex gap-1 overflow-x-auto px-2 py-1 lg:flex-col lg:overflow-visible lg:px-3 lg:py-4">
            {STAFF_LINKS.map(([href, key]) => {
              const current = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href} className="shrink-0">
                  <Link href={href} aria-current={current ? "page" : undefined}
                    className={`inline-flex min-h-target w-full items-center rounded-md px-3 text-sm ${current ? "border-l-[3px] border-primary bg-bg-subtle font-semibold" : "border-l-[3px] border-transparent hover:bg-bg-subtle"}`}>{t(key)}</Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return <AdminShellView pathname={usePathname() ?? ""}>{children}</AdminShellView>;
}
