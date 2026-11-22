import Link from "next/link";
import { BadgeCheck, Package, ShieldCheck, Star } from "lucide-react";
import { db } from "@/server/db";
import { getHomeStats } from "@/server/home-stats";
import { t } from "@/i18n/en";

const fmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** Real aggregates; when the query fails or a number is meaningless we show "—" (never fabricate). Static: no count-up. */
export async function TrustStats() {
  const s = await getHomeStats(db);
  const pct = s && s.reviewsPublished > 0 ? `${Math.round((s.verifiedReviews / s.reviewsPublished) * 100)}%` : null;
  const items = [
    { icon: BadgeCheck, label: t("home.stats.verified"), value: s ? fmt.format(s.verifiedReviews) : null },
    { icon: Package, label: t("home.stats.products"), value: s ? fmt.format(s.productsReviewed) : null },
    { icon: ShieldCheck, label: t("home.stats.moderated"), value: pct },
    { icon: Star, label: t("home.stats.rating"), value: s?.averageRating != null ? Number(s.averageRating).toFixed(1) : null },
  ];
  return (
    <section aria-labelledby="home-stats" className="bg-bg-subtle">
      <div className="mx-auto max-w-content px-4 py-10 md:px-6 lg:px-8">
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 id="home-stats" className="text-xl font-semibold md:text-2xl">{t("home.stats.title")}</h2>
          <dl className="mt-4 grid grid-cols-2 gap-6 lg:grid-cols-4">
            {items.map(({ icon: Icon, label, value }) => (
              <div key={label}>
                <span aria-hidden="true" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-subtle text-on-accent-subtle"><Icon className="h-5 w-5" /></span>
                <dt className="mt-2 text-sm text-text-muted">{label}</dt>
                <dd className="text-3xl font-bold tabular-nums"><bdi>{value ?? <><span aria-hidden="true">—</span><span className="sr-only">{t("home.stats.na")}</span></>}</bdi></dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 flex flex-wrap items-center gap-x-4 text-xs text-text-muted">
            {s && <span>{t("home.stats.asOf", { date: s.asOf })}</span>}
            <Link href="/trust/verified-purchases" className="inline-flex min-h-target items-center text-sm text-link underline">{t("home.stats.link")}</Link>
          </p>
        </div>
      </div>
    </section>
  );
}

export function TrustStatsFallback() {
  return <div aria-hidden="true" className="min-h-64 bg-bg-subtle" />;
}
