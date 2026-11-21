/** Pure ownership-claim rules (M3 spec §5, ADR-0014). No I/O and no clock: callers pass `now`, so tests use a fake clock. */
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export const CLAIM_CONFIG = {
  challengeTtlMs: 72 * HOUR_MS,
  graceMs: 14 * DAY_MS,
  validityMs: 365 * DAY_MS, // "12 months", rolling
  reverifyIntervalMs: 30 * DAY_MS, // monthly re-check of DNS/META
  graceRecheckMs: 24 * HOUR_MS,
  contestResponseMs: 7 * DAY_MS,
  infoTimeoutMs: 14 * DAY_MS,
  maxActivePerSeller: 3,
  maxSubmissionsPerSellerPerDay: 5,
  spotCheckRate: { DNS_TXT: 0.1, META_TAG: 0.1, BUSINESS_EMAIL_DOMAIN: 0.25 } as Record<string, number>,
  highVolume: { productReviews: 50, brandReviews: 500 },
  /** Back-off after a failed automatic check: 5 m, 15 m, 1 h, 6 h, 24 h, 48 h. */
  backoffMs: [5 * 60_000, 15 * 60_000, HOUR_MS, 6 * HOUR_MS, 24 * HOUR_MS, 48 * HOUR_MS],
} as const;

export type ClaimStatus = "PENDING" | "VERIFIED" | "REJECTED" | "CONTESTED" | "EXPIRED" | "REVOKED" | "WITHDRAWN";
export type ClaimMethod = "DNS_TXT" | "META_TAG" | "BUSINESS_EMAIL_DOMAIN" | "DOCUMENT" | "MARKETPLACE";
export type ClaimScope = "SELLER" | "PRODUCT";
export type CheckOutcome = "PASS" | "NOT_FOUND" | "MISMATCH" | "FETCH_BLOCKED" | "FETCH_ERROR" | "DNS_ERROR";

export const AUTO_METHODS: readonly ClaimMethod[] = ["DNS_TXT", "META_TAG", "BUSINESS_EMAIL_DOMAIN"];
export const WORKER_CHECKED_METHODS: readonly ClaimMethod[] = ["DNS_TXT", "META_TAG"]; // checked by the verification worker
export const isAutoMethod = (m: ClaimMethod) => AUTO_METHODS.includes(m);
export const isManualMethod = (m: ClaimMethod) => m === "DOCUMENT" || m === "MARKETPLACE";

// -- Challenge (SEL-001) --------------------------------------------------------------------------------------------

export const CHALLENGE_PREFIX = "rp-verify=";
/** 32 random bytes, base64url: 256 bits (>= the 128-bit minimum). Unique per claim (DB unique index). */
export const generateChallenge = (): string => randomBytes(32).toString("base64url");
export const dnsChallengeHost = (domain: string) => `_rp-verify.${domain}`;
export const dnsChallengeRecord = (value: string) => `${CHALLENGE_PREFIX}${value}`;
export const metaChallengeTag = (value: string) => `<meta name="rp-verify" content="${value}">`;

const eq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export interface ChallengeFacts { challengeValue: string | null; challengeExpiresAt: Date | null }

/**
 * Compares the tokens a check observed with THIS claim's own value only (so a token placed for claim X never satisfies
 * claim Y), in constant time, and never after expiry.
 */
export function evaluateObservedTokens(claim: ChallengeFacts, observed: readonly string[], now: Date): CheckOutcome {
  if (!claim.challengeValue || !claim.challengeExpiresAt || claim.challengeExpiresAt <= now) return "NOT_FOUND";
  const tokens = observed.slice(0, 5).map((t) => t.slice(0, 128));
  if (tokens.length === 0) return "NOT_FOUND";
  let hit = false;
  for (const t of tokens) if (eq(t, claim.challengeValue)) hit = true; // no early exit
  return hit ? "PASS" : "MISMATCH";
}

/** Next check after `attempts` failures (0-based), capped at the challenge expiry. */
export function nextCheckAt(attempts: number, now: Date, challengeExpiresAt: Date | null): Date {
  const delay = CLAIM_CONFIG.backoffMs[Math.min(attempts, CLAIM_CONFIG.backoffMs.length - 1)]!;
  const t = new Date(now.getTime() + delay);
  return challengeExpiresAt && t > challengeExpiresAt ? challengeExpiresAt : t;
}

// -- Required approvals (SEL-004, §5.10) ----------------------------------------------------------------------------

export interface ApprovalFacts {
  scope: ClaimScope;
  method: ClaimMethod;
  /** Another seller has a claim on the same domain/product (PENDING, CONTESTED or VERIFIED), or a VERIFIED seller shares the name skeleton. */
  brandHasExistingClaim: boolean;
  /** PRODUCT: product.reviewCount; SELLER: summed reviewCount of the brand's ACTIVE products. */
  reviewCount: number;
  nameReviewFlag: boolean;
  contested?: boolean;
}

export type HumanReviewReason = "MANUAL_METHOD" | "CONFLICT" | "HIGH_VOLUME" | "NAME_FLAG" | "PRODUCT_SCOPE";

/** Whether the claim must go to the human queue, why, and how many distinct approvers it needs. */
export function reviewRequirements(f: ApprovalFacts): { requiresHumanReview: boolean; reason: HumanReviewReason | null; requiredApprovals: 1 | 2 } {
  const t = CLAIM_CONFIG.highVolume;
  const highVolume = f.reviewCount >= (f.scope === "PRODUCT" ? t.productReviews : t.brandReviews);
  const second = !!f.contested || f.brandHasExistingClaim || highVolume || f.nameReviewFlag;
  const reason: HumanReviewReason | null = isManualMethod(f.method) ? "MANUAL_METHOD" : f.scope === "PRODUCT" ? "PRODUCT_SCOPE" : f.brandHasExistingClaim ? "CONFLICT" : highVolume ? "HIGH_VOLUME" : f.nameReviewFlag ? "NAME_FLAG" : null;
  // SEL-004: DOCUMENT and MARKETPLACE always need a human, and a second reviewer under the rules above.
  return { requiresHumanReview: reason !== null, reason, requiredApprovals: second ? 2 : 1 };
}

export interface AutoApprovalFacts {
  method: ClaimMethod;
  scope: ClaimScope;
  outcome: CheckOutcome;
  requiresHumanReview: boolean;
  hasConflict: boolean;
  claimantIsOwnerOrManager: boolean;
  claimantEmailVerified: boolean;
  sellerBlocked: boolean; // SUSPENDED or CLOSED
  challengeUnexpired: boolean;
}
/** §5.4: ALL conditions must hold, otherwise the claim stays PENDING for staff. DOCUMENT/MARKETPLACE can never pass. */
export function canAutoApprove(f: AutoApprovalFacts): boolean {
  return (
    isAutoMethod(f.method) && f.scope === "SELLER" && f.outcome === "PASS" && !f.requiresHumanReview && !f.hasConflict &&
    f.claimantIsOwnerOrManager && f.claimantEmailVerified && !f.sellerBlocked && f.challengeUnexpired
  );
}

/** Sampled with crypto.randomInt so it cannot be predicted from ids (§5.8). `rand` is injectable for tests. */
export function sampleSpotCheck(method: ClaimMethod, rand: (max: number) => number = (m) => randomInt(m)): boolean {
  const rate = CLAIM_CONFIG.spotCheckRate[method] ?? 0;
  return rand(10_000) < rate * 10_000;
}

// -- State machine (§5.5) -------------------------------------------------------------------------------------------

export type ClaimAction =
  | "CHECK_FAILED" | "CHECK_PASSED" | "STAFF_APPROVE" | "STAFF_REJECT" | "REQUEST_INFO" | "EXPIRE_CHALLENGE" | "EXPIRE_INFO" | "WITHDRAW"
  | "REVERIFY_PASSED" | "ENTER_GRACE" | "EXPIRE_GRACE" | "REVOKE" | "SPOT_CHECK";

/** Allowed `from` statuses per action. Anything else is `invalid_transition` (SEL-014). Terminal statuses have no exits. */
export const CLAIM_TRANSITIONS: Record<ClaimAction, readonly ClaimStatus[]> = {
  CHECK_FAILED: ["PENDING"],
  CHECK_PASSED: ["PENDING"],
  STAFF_APPROVE: ["PENDING", "CONTESTED"],
  STAFF_REJECT: ["PENDING", "CONTESTED"],
  REQUEST_INFO: ["PENDING"],
  EXPIRE_CHALLENGE: ["PENDING"],
  EXPIRE_INFO: ["PENDING"],
  WITHDRAW: ["PENDING", "CONTESTED"],
  REVERIFY_PASSED: ["VERIFIED"],
  ENTER_GRACE: ["VERIFIED"],
  EXPIRE_GRACE: ["VERIFIED"],
  REVOKE: ["VERIFIED"],
  SPOT_CHECK: ["VERIFIED"],
};

export class InvalidClaimTransitionError extends Error {
  constructor(public from: ClaimStatus, public action: ClaimAction) {
    super(`invalid_transition:${from}:${action}`);
    this.name = "InvalidClaimTransitionError";
  }
}
export const canClaimTransition = (from: ClaimStatus, action: ClaimAction) => CLAIM_TRANSITIONS[action].includes(from);
export function assertClaimTransition(from: ClaimStatus, action: ClaimAction): void {
  if (!canClaimTransition(from, action)) throw new InvalidClaimTransitionError(from, action);
}

// -- Re-verification, grace and downgrade (SEL-008, §5.6) -------------------------------------------------------------

export interface VerifiedClaimFacts {
  method: ClaimMethod;
  verifiedUntil: Date | null;
  lastCheckAt: Date | null;
  graceEndsAt: Date | null;
  /** Outcome of the latest re-check (null = none since the last pass). */
  lastCheckOutcome: CheckOutcome | null;
}
export type ReverifyDecision = "NONE" | "RECHECK_DUE" | "RENEW" | "ENTER_GRACE" | "EXPIRE_GRACE";

/** DNS/META: is a re-check due now? Monthly; daily while in grace. */
export function isRecheckDue(c: VerifiedClaimFacts, now: Date): boolean {
  if (!WORKER_CHECKED_METHODS.includes(c.method)) return false;
  const interval = c.graceEndsAt ? CLAIM_CONFIG.graceRecheckMs : CLAIM_CONFIG.reverifyIntervalMs;
  return !c.lastCheckAt || c.lastCheckAt.getTime() <= now.getTime() - interval;
}

/** What to do with a VERIFIED claim given a fresh re-check outcome. Pure, so a fake clock drives it. */
export function decideReverify(c: VerifiedClaimFacts, outcome: CheckOutcome, now: Date): ReverifyDecision {
  if (outcome === "PASS") return "RENEW"; // clears grace
  if (!c.graceEndsAt) return "ENTER_GRACE";
  return c.graceEndsAt <= now ? "EXPIRE_GRACE" : "NONE";
}

/** The sweeper-side decision for claims not re-checked by the worker (EMAIL/DOCUMENT/MARKETPLACE) and for lapsed grace. */
export function decideValidity(c: VerifiedClaimFacts, now: Date): ReverifyDecision {
  if (c.graceEndsAt) {
    // DNS/META expire only when the latest re-check still fails; the others expire at the end of grace without renewal.
    const failing = WORKER_CHECKED_METHODS.includes(c.method) ? c.lastCheckOutcome !== "PASS" : true;
    return c.graceEndsAt <= now && failing ? "EXPIRE_GRACE" : "NONE";
  }
  if (!WORKER_CHECKED_METHODS.includes(c.method) && c.verifiedUntil && c.verifiedUntil <= now) return "ENTER_GRACE";
  return "NONE";
}
