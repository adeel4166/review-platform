import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/i18n/en";

const LINKS = [
  ["/admin/moderation", "staff.nav.moderation"], ["/admin/appeals", "staff.nav.appeals"], ["/admin/seller-claims", "staff.nav.claims"],
  ["/admin/proofs", "staff.nav.proofs"], ["/admin/media", "staff.nav.media"], ["/admin/approvals", "staff.nav.approvals"], ["/admin/enforcement", "staff.nav.enforcement"],
] as const;

/** Staff shell (07): the same rail on every admin page. APIs and pages enforce roles; the rail is only navigation. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav aria-label={t("staff.nav.label")} className="border-b border-border bg-surface">
        <ul className="mx-auto flex max-w-content flex-wrap gap-x-4 px-4">
          {LINKS.map(([href, key]) => <li key={href}><Link href={href} className="inline-flex min-h-target items-center text-link underline">{t(key)}</Link></li>)}
        </ul>
      </nav>
      {children}
    </>
  );
}
