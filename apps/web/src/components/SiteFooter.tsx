import Link from "next/link";
import { t } from "@/i18n/en";

const a = "inline-flex min-h-target items-center text-link underline";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-bg-subtle">
      <div className="mx-auto max-w-content px-4 py-8 md:px-6 lg:px-8">
        <nav aria-label={t("footer.label")} className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h2 className="text-sm font-semibold">{t("footer.product")}</h2>
            <ul className="mt-2">
              <li><Link className={a} href="/products">{t("footer.browse")}</Link></li>
              <li><Link className={a} href="/compare">{t("compare.h1")}</Link></li>
              <li><Link className={a} href="/trust/verified-purchases">{t("footer.trust")}</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold">{t("footer.help")}</h2>
            <ul className="mt-2">
              <li><Link className={a} href="/appeals/new">{t("footer.appeals")}</Link></li>
              <li><Link className={a} href="/seller">{t("footer.sellers")}</Link></li>
            </ul>
          </div>
        </nav>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-sm text-text-muted">
          <p>{t("footer.copyright", { year: 2026 })}</p>
          <p><Link className="text-link underline" href="/trust/verified-purchases">{t("footer.moderated")}</Link></p>
        </div>
      </div>
    </footer>
  );
}
