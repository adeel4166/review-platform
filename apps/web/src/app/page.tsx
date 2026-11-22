import Link from "next/link";
import { t } from "@/i18n/en";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
      <p className="text-text-muted">{t("home.tagline")}</p>
      <form role="search" action="/products" className="mt-4 flex flex-wrap gap-2">
        <label htmlFor="home-q" className="sr-only">{t("products.search.label")}</label>
        <input id="home-q" name="q" type="search" maxLength={100} placeholder={t("products.search.label")} className="min-h-target min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3" />
        <button type="submit" className="min-h-target rounded-md bg-primary px-4 text-on-primary hover:bg-primary-hover">{t("products.search.submit")}</button>
      </form>
      <p className="mt-4"><Link href="/products" className="text-link underline">{t("nav.products")}</Link></p>
    </main>
  );
}
