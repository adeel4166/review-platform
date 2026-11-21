import { t } from "@/i18n/en";

export function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-sm font-medium text-success">
      <span aria-hidden="true">✓</span>
      {t("review.verified")}
    </span>
  );
}
