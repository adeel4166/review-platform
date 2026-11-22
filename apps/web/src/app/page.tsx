import { Suspense } from "react";
import Link from "next/link";
import { t } from "@/i18n/en";
import { HomeProducts, HomeProductsFallback } from "@/components/HomeProducts";

const steps = [1, 2, 3] as const;

export default function Home() {
  return (
    <main>
      <section aria-labelledby="home-h1" className="bg-bg-subtle">
        <div className="mx-auto max-w-content px-4 py-12 md:px-6 md:py-16 lg:px-8">
          <h1 id="home-h1" className="text-3xl font-bold leading-tight lg:text-4xl">{t("app.name")}</h1>
          <p className="mt-2 max-w-reading text-lg text-text-muted">{t("home.tagline")} {t("home.sub")}</p>
          <form role="search" action="/products" className="mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row">
            <label htmlFor="home-q" className="sr-only">{t("products.search.label")}</label>
            <input id="home-q" name="q" type="search" maxLength={100} placeholder={t("home.search.cta")} className="min-h-[3.5rem] min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-4 shadow-md" />
            <button type="submit" className="min-h-[3.5rem] rounded-xl bg-primary px-6 font-semibold text-on-primary hover:bg-primary-hover">{t("products.search.submit")}</button>
          </form>
          <p className="mt-4"><Link href="/products" className="inline-flex min-h-target items-center text-link underline">{t("nav.products")}</Link></p>
        </div>
      </section>
      <Suspense fallback={<HomeProductsFallback />}><HomeProducts /></Suspense>
      <section aria-labelledby="home-how" className="bg-bg-subtle">
        <div className="mx-auto max-w-content px-4 py-10 md:px-6 lg:px-8">
          <h2 id="home-how" className="text-xl font-semibold md:text-2xl">{t("home.how.title")}</h2>
          <ol className="mt-4 grid gap-4 md:grid-cols-3">
            {steps.map((n) => (
              <li key={n} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
                <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">{n}</span>
                <h3 className="mt-2 text-lg font-semibold">{t(`home.how.${n}.title`)}</h3>
                <p className="mt-1 text-text-muted">{t(`home.how.${n}.body`)}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4"><Link href="/trust/verified-purchases" className="inline-flex min-h-target items-center text-link underline">{t("home.how.learn")}</Link></p>
        </div>
      </section>
      <section aria-labelledby="home-cta" className="bg-primary text-on-primary">
        <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-4 px-4 py-8 md:px-6 lg:px-8">
          <h2 id="home-cta" className="text-xl font-semibold">{t("home.cta.title")}</h2>
          <Link href="/products" className="inline-flex min-h-target items-center rounded-md bg-surface px-4 font-semibold text-primary">{t("product.writeReview")}</Link>
        </div>
      </section>
    </main>
  );
}
