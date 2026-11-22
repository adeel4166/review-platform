import { createHmac } from "node:crypto";
import { z } from "zod";

/** Verified Buyer proof domain (ADR-0008, m4-m5-spec 5). Pure: no I/O. */

export const PROOF_MAX_ATTEMPTS = 3;
export const PROOF_MAX_FILES = 5;
export const PROOF_SLA_HOURS = 72;
export const PROOF_CONSENT_VERSION = "2026-12";
export const PROOF_REDACTED_RETENTION_DAYS = 90;
export const PROOF_DRAFT_TTL_HOURS = 24;

export const PROOF_FLAGS = [
  "DATE_IN_FUTURE", "DATE_AFTER_REVIEW", "PRODUCT_MISMATCH", "MERCHANT_UNKNOWN", "DUPLICATE_FILE", "NEAR_DUPLICATE_IMAGE",
  "DUPLICATE_ORDER_OTHER_ACCOUNT", "DUPLICATE_ORDER_SAME_ACCOUNT", "PRODUCER_EDITOR", "PDF_MODIFIED", "IMAGE_EDITOR_TAG", "ELA_ANOMALY",
  "REDACTION_FULL_MASK", "REDACTION_UNREADABLE", "MALWARE_FILE", "AI_SKIPPED",
] as const;
export const ProofFlag = z.enum(PROOF_FLAGS);
export type ProofFlagT = z.infer<typeof ProofFlag>;

export const PROOF_DECISION_REASONS = ["UNREADABLE", "NOT_A_PURCHASE_DOCUMENT", "PRODUCT_MISMATCH", "MERCHANT_UNVERIFIABLE", "DATE_INVALID", "DUPLICATE_PROOF", "SUSPECTED_FORGERY", "OTHER"] as const;
export type ProofDecisionReasonT = (typeof PROOF_DECISION_REASONS)[number];
/** Reason codes that also write a PROOF_REJECTED_FRAUD trust signal. */
export const FRAUD_REASONS: readonly ProofDecisionReasonT[] = ["SUSPECTED_FORGERY", "DUPLICATE_PROOF"];

/** Allow-list schema; parse() strips nothing it does not know because `.strict()` rejects it (PRV-001, PRV-021). */
export const proofAssessment = z.object({
  v: z.literal(1),
  provider: z.string().max(32),
  model: z.string().max(64),
  promptVersion: z.string().max(16),
  merchant: z.object({ name: z.string().max(120), confidence: z.number().min(0).max(1) }).optional(),
  purchaseDate: z.object({ date: z.string().date(), confidence: z.number().min(0).max(1) }).optional(),
  productMatch: z.number().min(0).max(1).optional(),
  flags: z.array(ProofFlag).max(20),
  skipped: z.enum(["BUDGET", "PROVIDER_ERROR"]).optional(),
}).strict();
export type ProofAssessment = z.infer<typeof proofAssessment>;

/** Strips every key that is not on the allow-list (e.g. `ocrText`, `name`, `address`) instead of failing the job. */
export function sanitizeAssessment(raw: unknown): ProofAssessment {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: string) => o[k];
  const merchant = pick("merchant") && typeof pick("merchant") === "object" ? { name: (pick("merchant") as Record<string, unknown>).name, confidence: (pick("merchant") as Record<string, unknown>).confidence } : undefined;
  const pd = pick("purchaseDate") && typeof pick("purchaseDate") === "object" ? { date: (pick("purchaseDate") as Record<string, unknown>).date, confidence: (pick("purchaseDate") as Record<string, unknown>).confidence } : undefined;
  return proofAssessment.parse({
    v: 1, provider: pick("provider"), model: pick("model"), promptVersion: pick("promptVersion"),
    ...(merchant ? { merchant } : {}), ...(pd ? { purchaseDate: pd } : {}),
    ...(typeof pick("productMatch") === "number" ? { productMatch: pick("productMatch") } : {}),
    flags: Array.isArray(pick("flags")) ? (pick("flags") as unknown[]).filter((f) => ProofFlag.safeParse(f).success) : [],
    ...(pick("skipped") ? { skipped: pick("skipped") } : {}),
  });
}

/** `ORDER_REF_HMAC_KEYS` = `keyId:base64,keyId:base64`, newest first (R-6). */
export interface OrderRefKey { id: number; key: Buffer }
export function parseOrderRefKeys(raw: string | undefined): OrderRefKey[] {
  if (!raw) return [];
  return raw.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf(":");
    const id = Number(p.slice(0, i));
    if (i < 1 || !Number.isInteger(id) || id < 0 || id > 127) throw new Error("ORDER_REF_HMAC_KEYS: invalid key id");
    return { id, key: Buffer.from(p.slice(i + 1), "base64") };
  });
}
export const normaliseOrderRef = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** HMAC-SHA256(key, merchantSlug + ":" + normalised). The raw reference is never stored (PRV-009). */
export function hashOrderRef(key: OrderRefKey, merchantSlug: string, raw: string): { hash: string; keyId: number } {
  const h = createHmac("sha256", key.key).update(`${merchantSlug || "unknown"}:${normaliseOrderRef(raw)}`).digest("hex");
  return { hash: h, keyId: key.id };
}
/** All candidate hashes across keys, newest first: a match against an older key's hash is still found (PRV-024). */
export const orderRefCandidates = (keys: readonly OrderRefKey[], merchantSlug: string, raw: string): string[] => keys.map((k) => hashOrderRef(k, merchantSlug, raw).hash);

/** Rules of M4 proof creation (5.3). Returns the error code or null. */
export function proofEligibility(ctx: { reviewStatus: string; alreadyVerified: boolean; labelRevoked: boolean; openProof: boolean; rejectedCount: number }): { status: 404 | 409; code: string } | null {
  if (!["PENDING", "HIDDEN", "PUBLISHED"].includes(ctx.reviewStatus)) return { status: 404, code: "not_found" };
  if (ctx.alreadyVerified) return { status: 409, code: "already_verified" };
  if (ctx.labelRevoked) return { status: 409, code: "label_revoked" };
  if (ctx.openProof) return { status: 409, code: "proof_open_exists" };
  if (ctx.rejectedCount >= PROOF_MAX_ATTEMPTS) return { status: 409, code: "proof_attempts_exhausted" };
  return null;
}

/** ADR-0008 section 4 / PRV-016: `PROOF_AUTO_VERIFY=true` is refused at startup until a CEO decision (C-3). */
export function assertNoAutoVerify(env: Record<string, string | undefined> = process.env): void {
  if (env.PROOF_AUTO_VERIFY === "true") throw new Error("PROOF_AUTO_VERIFY=true is not allowed (ADR-0008: humans decide)");
}

export type ProofOriginalRetention = "AT_DECISION" | "APPEAL_WINDOW";
/** When originals must be purged: at decision, or decision + 30 d. Redacted copies: decision + retention days. */
export function proofRetention(decidedAt: Date, mode: ProofOriginalRetention = "AT_DECISION", redactedDays = PROOF_REDACTED_RETENTION_DAYS) {
  return {
    originalPurgeAt: mode === "AT_DECISION" ? decidedAt : new Date(decidedAt.getTime() + 30 * 86_400_000),
    redactedPurgeAt: new Date(decidedAt.getTime() + redactedDays * 86_400_000),
  };
}
