import { Suspense } from "react";
import Link from "next/link";
import { Sparkles, ShieldCheck, Star } from "lucide-react";
import { t } from "@/i18n/en";
import { HomeProducts, HomeProductsFallback } from "@/components/HomeProducts";
import { CategoryBento, CategoryBentoFallback } from "@/components/home/CategoryBento";
import { TrustStats, TrustStatsFallback } from "@/components/home/TrustStats";
import { Reveal } from "@/components/ui/Reveal";

export const dynamic = "force-dynamic";
const steps = [1, 2, 3] as const;

export default function Home() {
  return (
    <main>
      <section aria-labelledby="home-h1" className="relative overflow-hidden bg-bg">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-hero-mesh" />
        <div className="relative mx-auto grid max-w-content gap-10 px-4 pb-16 pt-12 md:px-6 lg:grid-cols-12 lg:px-8 lg:pb-24 lg:pt-20">
          <div className="lg:col-span-7">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-accent"><Sparkles aria-hidden="true" className="h-4 w-4" />{t("home.eyebrow")}</p>
            <h1 id="home-h1" className="mt-3 text-4xl font-bold leading-tight text-text lg:text-5xl">
              <span className="sr-only">{t("app.name")}: </span>
              {t("home.hero.title.pre")} <span className="bg-gradient-text-brand bg-clip-text text-primary [-webkit-text-fill-color:transparent]">{t("home.hero.title.accent")}</span>
            </h1>
            <p className="mt-3 max-w-reading text-lg text-text-muted">{t("home.tagline")} {t("home.sub")}</p>
            <form role="search" action="/products" className="mt-6 max-w-2xl">
              <label htmlFor="home-q" className="block text-sm font-medium">{t("home.search.visibleLabel")}</label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input id="home-q" name="q" type="search" maxLength={100} placeholder={t("home.search.cta")} className="min-h-[3.5rem] min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-4 shadow-md" />
                <button type="submit" className="min-h-[3.5rem] rounded-xl bg-primary px-6 font-semibold text-on-primary hover:bg-primary-hover">{t("products.search.submit")}</button>
              </div>
            </form>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/products" className="inline-flex min-h-target items-center rounded-lg bg-gradient-brand px-5 font-semibold text-on-brand hover:shadow-glow focus-visible:shadow-glow">{t("home.cta.browse")}</Link>
              <Link href="/products" className="inline-flex min-h-target items-center rounded-lg border border-border-strong bg-surface px-5 font-semibold">{t("product.writeReview")}</Link>
            </div>
          </div>
          <div aria-hidden="true" className="hidden md:block lg:col-span-5">
            <Reveal className="relative mx-auto max-w-sm">
              <div className="rounded-2xl border border-glass-border bg-glass p-5 shadow-md backdrop-blur">
                <div className="flex items-center gap-1 text-star"><Star className="h-4 w-4 fill-current" /><Star className="h-4 w-4 fill-current" /><Star className="h-4 w-4 fill-current" /><Star className="h-4 w-4 fill-current" /><Star className="h-4 w-4 fill-current" /></div>
                <p className="mt-2 font-semibold">{t("home.visual.title")}</p>
                <p className="mt-1 flex items-center gap-1 text-sm text-text-muted"><ShieldCheck className="h-4 w-4 text-success" />{t("home.visual.body")}</p>
              </div>
              <div className="-mt-2 ms-8 rounded-2xl border border-glass-border bg-glass-strong p-4 shadow-sm backdrop-blur">
                <p className="text-3xl font-bold tabular-nums">4.8</p>
                <div className="mt-2 h-2 rounded-full bg-star-empty/30"><div className="h-full w-5/6 rounded-full bg-star" /></div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
      <Suspense fallback={<CategoryBentoFallback />}><CategoryBento /></Suspense>
      <Suspense fallback={<HomeProductsFallback />}><HomeProducts /></Suspense>
      <Suspense fallback={<TrustStatsFallback />}><TrustStats /></Suspense>
      <section aria-labelledby="home-how">
        <div className="mx-auto max-w-content px-4 py-10 md:px-6 lg:px-8">
          <h2 id="home-how" className="text-xl font-semibold md:text-2xl">{t("home.how.title")}</h2>
          <ol className="mt-4 grid gap-4 md:grid-cols-3">
            {steps.map((n) => (
              <Reveal as="li" key={n} delay={n * 0.05} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
                <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">{n}</span>
                <h3 className="mt-2 text-lg font-semibold">{t(`home.how.${n}.title`)}</h3>
                <p className="mt-1 text-text-muted">{t(`home.how.${n}.body`)}</p>
              </Reveal>
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
