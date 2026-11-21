import Link from "next/link";
import { t } from "@/i18n/en";

/** Tab-style navigation as a list of links (wraps on narrow screens, no hidden overflow). `aria-current` marks the page. */
export function DashboardNav({ sellerId, current }: { sellerId: string; current: "overview" | "verification" }) {
  const items = [
    { key: "overview", href: `/seller/${sellerId}`, label: t("seller.dash.overview") },
    { key: "team", href: `/seller/${sellerId}#team-h`, label: t("seller.dash.team") },
    { key: "verification", href: `/seller/${sellerId}/verification`, label: t("seller.dash.verification") },
  ] as const;
  return (
    <nav aria-label={t("seller.dash.nav")} className="mt-4">
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i.key}><Link href={i.href} aria-current={i.key === current ? "page" : undefined}
            className={`inline-flex min-h-target items-center rounded-md border px-3 ${i.key === current ? "border-primary font-semibold" : "border-border"}`}>{i.label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
