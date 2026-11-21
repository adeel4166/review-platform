import { createHash, randomBytes } from "node:crypto";

/** ADR-0016 §3: 256-bit tokens, only the SHA-256 hex digest is stored, 24 h expiry. */
export const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const generateEmailToken = (): string => randomBytes(32).toString("base64url");
export const hashEmailToken = (raw: string): string => createHash("sha256").update(raw).digest("hex");
/** Resend limits per user (ADR-0016 §3.1). */
export const EMAIL_RESEND_PER_HOUR = 3;
export const EMAIL_RESEND_PER_DAY = 10;
