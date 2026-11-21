import { t, type MessageKey } from "@/i18n/en";

/**
 * Client-side validation for the write-review form. Limits mirror the server schemas
 * (server/validation.ts reviewInput, @rp/core media limits); the server remains authoritative.
 * Kept free of @rp/core imports so the client bundle does not pull in the AWS SDK.
 */
export const LIMITS = {
  titleMax: 150,
  bodyMin: 10,
  bodyMax: 10_000,
  mediaMax: 5,
  mediaMaxBytes: 10 * 1024 * 1024,
  mime: ["image/jpeg", "image/png", "image/webp"] as readonly string[],
} as const;

export interface ReviewDraft { rating: number; title: string; body: string }
export type ReviewErrors = Partial<Record<"rating" | "title" | "body", string>>;

export function validateReview(d: ReviewDraft): ReviewErrors {
  const e: ReviewErrors = {};
  if (!Number.isInteger(d.rating) || d.rating < 1 || d.rating > 5) e.rating = t("err.rating.required");
  const title = d.title.trim();
  if (!title) e.title = t("err.title.required");
  else if (title.length > LIMITS.titleMax) e.title = t("err.title.max", { max: LIMITS.titleMax });
  const body = d.body.trim();
  if (body.length < LIMITS.bodyMin) e.body = t("err.body.min", { min: LIMITS.bodyMin });
  else if (body.length > LIMITS.bodyMax) e.body = t("err.body.max", { max: LIMITS.bodyMax });
  return e;
}

/** Returns an error message or null. `existing` = images already attached. */
export function validateImage(f: { name: string; type: string; size: number }, existing: number): string | null {
  if (existing >= LIMITS.mediaMax) return t("err.file.limit", { max: LIMITS.mediaMax });
  if (!LIMITS.mime.includes(f.type)) return t("err.file.type", { name: f.name });
  if (f.size < 1) return t("err.file.empty", { name: f.name });
  if (f.size > LIMITS.mediaMaxBytes) return t("err.file.size", { name: f.name });
  return null;
}

export const errorKeyFor = (code: string | undefined): MessageKey =>
  code === "already_reviewed" ? "form.error.already_reviewed" : code === "unauthenticated" ? "form.error.unauthenticated" : "form.error.generic";
