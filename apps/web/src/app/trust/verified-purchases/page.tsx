import { t } from "@/i18n/en";

export const metadata = { title: `${t("trust.verified.title")} · ${t("app.name")}` };

/** Methodology page the Verified purchase tooltip links to (m4-m5-spec 5.1). Final copy is pending legal review (L-2). */
export default function VerifiedPurchasesPage() {
  return (
    <main className="mx-auto max-w-reading px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("trust.verified.title")}</h1>
      <p className="mt-4">{t("trust.verified.p1")}</p>
      <p className="mt-3">{t("trust.verified.p2")}</p>
      <p className="mt-3">{t("trust.verified.p3")}</p>
      <p className="mt-6 text-sm text-text-muted">{t("trust.verified.pending")}</p>
    </main>
  );
}
