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
  /** Photos per review (server: MEDIA_MAX_PHOTOS_PER_REVIEW). */
  mediaMax: 10,
  mediaMaxBytes: 10 * 1024 * 1024,
  mime: ["image/jpeg", "image/png", "image/webp"] as readonly string[],
  /** Videos per review, size and duration (server: MEDIA_MAX_VIDEOS_PER_REVIEW / MEDIA_MAX_VIDEO_BYTES / MEDIA_MAX_VIDEO_SECONDS). */
  videoMax: 2,
  videoMaxBytes: 52_428_800,
  videoMaxSeconds: 30.5,
  videoMime: ["video/mp4", "video/quicktime"] as readonly string[],
} as const;

export const isVideoType = (type: string) => LIMITS.videoMime.includes(type);

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

/**
 * Pre-check for one photo or video (fast feedback only; the server re-checks everything, incl. magic bytes and malware).
 * `existing` = counts already in the list. `durationSec` is optional (read from the video's metadata in the browser).
 */
export function validateMedia(
  f: { name: string; type: string; size: number },
  existing: { photos: number; videos: number },
  durationSec?: number | null,
): string | null {
  if (isVideoType(f.type)) {
    if (existing.videos >= LIMITS.videoMax) return t("err.file.videoLimit", { max: LIMITS.videoMax });
    if (f.size < 1) return t("err.file.empty", { name: f.name });
    if (f.size > LIMITS.videoMaxBytes) return t("err.file.videoSize", { name: f.name });
    if (durationSec != null && durationSec > LIMITS.videoMaxSeconds) return t("err.file.videoLong", { name: f.name });
    return null;
  }
  if (!LIMITS.mime.includes(f.type)) return t("err.file.mediaType", { name: f.name });
  return validateImage(f, existing.photos);
}

/** Maps an upload/API failure code to a message with the file name and what to do next (a11y checklist: 3.3.1). */
export function uploadErrorKey(code: string | undefined): MessageKey {
  switch (code) {
    case "too_large": return "form.media.err.too_large";
    case "media_limit": return "form.media.err.media_limit";
    case "upload_quota": return "form.media.err.upload_quota";
    case "slot_expired": return "form.media.err.slot_expired";
    case "network": return "form.media.err.network";
    case "validation": case "bad_request": return "form.media.err.type";
    default: return "form.media.err.generic";
  }
}

/** Messages for the reason a processed file was rejected (MediaFailureReason in @rp/core). Threat names are never shown. */
export function rejectionKey(reason: string | null | undefined): MessageKey {
  switch (reason) {
    case "MALWARE": case "BANNED_HASH": return "media.rejected.unsafe";
    case "TYPE_MISMATCH": case "UNSUPPORTED_TYPE": case "UNSUPPORTED_CODEC": return "media.rejected.type";
    case "TOO_LARGE": case "TOO_MANY_PIXELS": return "media.rejected.size";
    case "TOO_LONG": return "media.rejected.long";
    case "CORRUPT": return "media.rejected.corrupt";
    case "SCAN_UNAVAILABLE": case "PROCESSING_ERROR": case "MISSING_OBJECT": case "NOT_CONFIRMED": case "UPLOAD_EXPIRED": return "media.rejected.retry";
    default: return "media.rejected.generic";
  }
}

export const errorKeyFor = (code: string | undefined): MessageKey =>
  code === "already_reviewed" ? "form.error.already_reviewed" : code === "unauthenticated" ? "form.error.unauthenticated" : "form.error.generic";
