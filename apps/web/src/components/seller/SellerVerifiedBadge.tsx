import { t } from "@/i18n/en";

/**
 * Server-rendered only: no "use client", and the domain prop is passed in from a server loader (`getPublicSeller`).
 * Nothing client-side can switch this on. The domain is shown as stored (punycode A-label), never decoded to Unicode.
 */
export function SellerVerifiedBadge({ domain }: { domain: string }) {
  return (
    <p className="inline-flex items-center gap-1 rounded-full bg-success-bg px-3 py-1 text-sm font-medium text-success" data-testid="seller-verified-badge">
      <span aria-hidden="true">✓</span>
      <span>{t("seller.public.verified", { domain })}</span>
    </p>
  );
}
