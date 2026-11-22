import { t, type MessageKey } from "@/i18n/en";

const BANDS = ["NEW", "LOW", "MEDIUM", "HIGH"] as const;
export type Band = (typeof BANDS)[number];
const known = (b: string): b is Band => (BANDS as readonly string[]).includes(b);

/**
 * Trust band display (06, ADR-0029). Band only, never the numeric score (public DTOs omit it). Info is always text, never colour alone,
 * and the explanation is a native <details> so it works by keyboard and tap (WCAG 1.4.13).
 */
export function TrustBand({ band }: { band: string }) {
  const b: Band = known(band) ? band : "NEW";
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="trust-band">
      <span className="rounded-full border border-border-strong px-2 py-0.5 text-sm font-medium">{t("trust.label", { band: t(`trust.band.${b}` as MessageKey) })}</span>
      <details className="text-sm"><summary className="min-h-[1.5rem] cursor-pointer text-link underline">{t("trust.what")}</summary><p className="max-w-reading">{t("trust.explain")}</p></details>
    </span>
  );
}
