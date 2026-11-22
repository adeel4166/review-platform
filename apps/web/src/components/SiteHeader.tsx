import Link from "next/link";
import { t } from "@/i18n/en";
import { HeaderAuth } from "./HeaderAuth";
import { ThemeToggle } from "./ThemeToggle";

const navLink = "inline-flex min-h-target items-center rounded-md px-3 font-medium text-text hover:bg-bg-subtle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 md:px-6 lg:px-8">
        <Link href="/" className="inline-flex min-h-target items-center text-lg font-bold text-primary">{t("app.name")}</Link>
        <nav aria-label={t("nav.main")} className="order-3 flex w-full items-center gap-1 overflow-x-auto md:order-none md:w-auto">
          <Link href="/products" className={navLink}>{t("nav.products")}</Link>
          <Link href="/compare" className={navLink}>{t("compare.h1")}</Link>
          <Link href="/seller" className={navLink}>{t("nav.sellers")}</Link>
        </nav>
        <form role="search" action="/products" className="ml-auto hidden min-w-0 max-w-md flex-1 md:block">
          <label htmlFor="hdr-q" className="sr-only">{t("products.search.label")}</label>
          <input id="hdr-q" name="q" type="search" maxLength={100} placeholder={t("products.search.label")} className="min-h-target w-full rounded-md border border-border-strong bg-surface px-3" />
        </form>
        <div className="ml-auto flex items-center gap-1 md:ml-0"><ThemeToggle /><HeaderAuth /></div>
      </div>
    </header>
  );
}
