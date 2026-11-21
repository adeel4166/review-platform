import Link from "next/link";
import { t } from "@/i18n/en";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <nav aria-label={t("nav.main")} className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold">{t("app.name")}</Link>
        <Link href="/products" className="inline-flex min-h-target items-center text-link underline">{t("nav.products")}</Link>
      </nav>
    </header>
  );
}
