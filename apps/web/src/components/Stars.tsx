import { t } from "@/i18n/en";

/** Visual stars are decorative; the text label carries the meaning (never colour/shape alone). */
export function Stars({ value, className = "" }: { value: number; className?: string }) {
  const full = Math.round(value);
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span aria-hidden="true" className="tracking-tight">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= full ? "text-star" : "text-star-empty"}>★</span>
        ))}
      </span>
      <span className="sr-only">{t("product.rating.label", { rating: value })}</span>
    </span>
  );
}
