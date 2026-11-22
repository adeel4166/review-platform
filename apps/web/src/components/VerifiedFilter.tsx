"use client";

import { useRouter } from "next/navigation";
import { t } from "@/i18n/en";

/**
 * 'Verified purchases only' switch (wireframe 02): role=switch, URL-synced (`?verified=1`) so it is shareable and
 * back-button safe. Focus stays on the switch; the result count is announced from the server-rendered live region.
 */
export function VerifiedFilter({ on, href }: { on: boolean; href: string }) {
  const router = useRouter();
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => router.push(href, { scroll: false })}
      className="inline-flex min-h-target items-center gap-2 rounded-md border border-border-strong bg-surface px-3 font-medium">
      <span aria-hidden="true" className={`inline-flex h-5 w-9 items-center rounded-full border border-border-strong p-0.5 ${on ? "justify-end bg-primary" : "justify-start bg-bg-subtle"}`}>
        <span className="h-3.5 w-3.5 rounded-full bg-surface ring-1 ring-border-strong" />
      </span>
      {t("product.verifiedOnly")}
    </button>
  );
}
