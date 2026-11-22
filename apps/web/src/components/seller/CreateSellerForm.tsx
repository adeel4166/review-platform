"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n/en";
import { ApiError, api } from "@/lib/upload";
import { field, primaryBtn } from "./ui";

export function CreateSellerForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data: Record<string, string> = { name: String(f.get("name") ?? "").trim() };
    const website = String(f.get("websiteUrl") ?? "").trim();
    const description = String(f.get("description") ?? "").trim();
    if (website) data.websiteUrl = website;
    if (description) data.description = description;
    setError(null);
    setBusy(true);
    try {
      const created = await api<{ id: string }>("/api/sellers", { method: "POST", body: JSON.stringify(data) });
      router.push(`/seller/${created.id}`);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(
        code === "EMAIL_NOT_VERIFIED" ? t("seller.new.error.verify")
        : code === "slug_taken" ? t("seller.new.error.slug")
        : code === "rate_limited" ? t("seller.new.error.rate")
        : err instanceof ApiError && err.status === 400 ? t("seller.new.error.validation")
        : t("seller.generic.error"),
      );
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4" noValidate>
      {error && <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-danger">⚠ {error}</p>}
      <div>
        <label htmlFor="seller-name" className="font-medium">{t("seller.new.name")} <span className="text-text-muted">({t("form.required")})</span></label>
        <input id="seller-name" name="name" required minLength={2} maxLength={120} autoComplete="organization" className={field} />
      </div>
      <div>
        <label htmlFor="seller-website" className="font-medium">{t("seller.new.website")}</label>
        <p id="seller-website-hint" className="text-sm text-text-muted">{t("seller.new.websiteHint")}</p>
        <input id="seller-website" name="websiteUrl" type="url" autoComplete="url" aria-describedby="seller-website-hint" className={field} />
      </div>
      <div>
        <label htmlFor="seller-description" className="font-medium">{t("seller.new.description")}</label>
        <textarea id="seller-description" name="description" rows={4} maxLength={5000} className={field} />
      </div>
      <button type="submit" disabled={busy} className={primaryBtn}>{t("seller.new.submit")}</button>
    </form>
  );
}
