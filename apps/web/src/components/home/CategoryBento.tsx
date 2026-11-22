import Link from "next/link";
import { ArrowRight, Layers } from "lucide-react";
import { db } from "@/server/db";
import { listCategoryCounts } from "@/server/home-stats";
import { t } from "@/i18n/en";
import { EmptyState } from "../ui/EmptyState";
import { Reveal } from "../ui/Reveal";

export async function CategoryBento() {
  const cats = await listCategoryCounts(db, 7);
  return (
    <section aria-labelledby="home-cats" className="mx-auto max-w-content px-4 py-10 md:px-6 lg:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="home-cats" className="text-xl font-semibold md:text-2xl">{t("home.categories.title")}</h2>
        <Link href="/products" className="inline-flex min-h-target items-center text-link underline">{t("home.categories.all")}</Link>
      </div>
      {cats.length === 0 ? <div className="mt-4"><EmptyState title={t("home.categories.empty")} /></div> : (
        <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
          {cats.map((c, i) => {
            const featured = i === 0;
            return (
              <Reveal as="li" key={c.id} delay={i * 0.04}
                className={`group relative min-h-28 rounded-2xl p-4 transition-all hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${featured ? "col-span-2 bg-gradient-brand text-on-brand shadow-md hover:shadow-glow md:row-span-2 lg:col-span-2" : "border border-border bg-surface shadow-sm hover:shadow-md lg:col-span-2"}`}>
                <span aria-hidden="true" className={`inline-flex items-center justify-center rounded-full ${featured ? "h-14 w-14 bg-white/20" : "h-10 w-10 bg-primary-subtle text-on-primary-subtle"}`}><Layers className={featured ? "h-7 w-7" : "h-5 w-5"} /></span>
                <h3 className={`mt-3 font-semibold ${featured ? "text-2xl" : "text-lg"}`}>
                  <Link href={`/products?category=${encodeURIComponent(c.slug)}`} aria-label={t("home.categories.tile", { category: c.name, count: c.count })} className="after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-offset-4">{c.name}</Link>
                </h3>
                <p className={`text-sm ${featured ? "text-on-brand" : "text-text-muted"}`}><bdi>{t("home.categories.count", { count: c.count })}</bdi></p>
              </Reveal>
            );
          })}
          <li className="relative flex min-h-28 items-center justify-between gap-2 rounded-2xl border border-dashed border-border bg-bg-subtle p-4 lg:col-span-1">
            <Link href="/products" className="font-medium after:absolute after:inset-0 after:content-['']">{t("home.categories.all")}</Link>
            <ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0 rtl:-scale-x-100" />
          </li>
        </ul>
      )}
    </section>
  );
}

export function CategoryBentoFallback() {
  return <div aria-hidden="true" className="mx-auto min-h-72 max-w-content px-4 py-10 md:px-6 lg:px-8" />;
}
