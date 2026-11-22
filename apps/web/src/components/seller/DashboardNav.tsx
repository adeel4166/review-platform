import Link from "next/link";
import { t } from "@/i18n/en";

/** Section navigation as a link list: tabs on small screens (wraps, no hidden overflow, 360px safe), `aria-current` marks the page. */
export function DashboardNav({ sellerId, current }: { sellerId: string; current: "overview" | "verification" }) {
  const items = [
    { key: "overview", href: `/seller/${sellerId}`, label: t("seller.dash.overview") },
    { key: "team", href: `/seller/${sellerId}#team-h`, label: t("seller.dash.team") },
    { key: "verification", href: `/seller/${sellerId}/verification`, label: t("seller.dash.verification") },
  ] as const;
  return (
    <nav aria-label={t("seller.dash.nav")} className="mt-4 border-b border-border">
      <ul className="flex flex-wrap gap-x-1">
        {items.map((i) => (
          <li key={i.key}><Link href={i.href} aria-current={i.key === current ? "page" : undefined}
            className={`inline-flex min-h-target items-center border-b-2 px-3 ${i.key === current ? "border-primary font-semibold" : "border-transparent text-text-muted hover:text-text"}`}>{i.label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
