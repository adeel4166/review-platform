import { CATEGORIES, HARD_FLOORS, thresholdFor, type Category, type ModerationConfig, type TrustBand } from "./config";

export type Verdict = "CLEAN" | "VIOLATION" | "UNSURE";
export type FailureCode = "timeout" | "http_5xx" | "http_429" | "network" | "schema" | "unsupported_language" | "breaker" | "lost_job";
export type ScoreMap = Readonly<Record<Category, number>>;

export interface ClassifyInput {
  contentType: "REVIEW" | "SELLER_REPLY" | "COMMENT" | "POST" | "MEDIA";
  trustBand: TrustBand;
  hasExternalLink?: boolean;
  rating?: number | null;
  /** Reviews received by the product in the last hour (CLS-010). */
  productReviewsLastHour?: number;
  unsupportedLanguage?: boolean;
  mediaTimeout?: boolean;
  malwareMedia?: boolean;
  /** T20 after a human decision (resubmitAfterHuman). */
  resubmitAfterHuman?: boolean;
  /** M7: NEAR_DUPLICATE / PRODUCT_BURST. */
  extraForceUnsure?: readonly string[];
}
export interface RuleHit {
  id: string;
  /** true -> deterministic violation (CLS-005). */
  violation: boolean;
}
export type ProviderOutcome = { ok: true; scores: ScoreMap } | { ok: false; failureCode: FailureCode };

export interface Classification {
  verdict: Verdict;
  source: "AI" | "RULE";
  reasonCode?: string;
  failureCode?: FailureCode;
  topCategory?: Category;
  /** Present for VIOLATION driven by scores. */
  zeroTolerance?: boolean;
  forced?: string[];
}

/** A score map is usable only if all 13 categories are finite numbers in [0,1] (AIF-008, CLS-013). */
export function isCompleteScoreMap(s: unknown): s is ScoreMap {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return CATEGORIES.every((c) => typeof o[c] === "number" && Number.isFinite(o[c]) && (o[c] as number) >= 0 && (o[c] as number) <= 1);
}

const top = (s: ScoreMap): Category => CATEGORIES.reduce((a, c) => (s[c] > s[a] ? c : a), CATEGORIES[0]);

/** Pipeline §2.2, steps in order. Floors come from HARD_FLOORS, never from `cfg` (CFG-002). */
export function classify(input: ClassifyInput, outcome: ProviderOutcome, cfg: ModerationConfig, ruleHits: readonly RuleHit[] = []): Classification {
  const hit = ruleHits.find((r) => r.violation);
  if (hit) return { verdict: "VIOLATION", source: "RULE", reasonCode: hit.id };
  const forced: string[] = [];
  if (HARD_FLOORS.forceUnsure.malwareMedia && input.malwareMedia) forced.push("MEDIA_MALWARE");
  if (!outcome.ok) {
    if (outcome.failureCode === "unsupported_language") return { verdict: "UNSURE", source: "RULE", reasonCode: "UNSUPPORTED_LANGUAGE", failureCode: outcome.failureCode, forced: [...forced, "UNSUPPORTED_LANGUAGE"] };
    return { verdict: "UNSURE", source: "RULE", reasonCode: "AI_UNAVAILABLE", failureCode: outcome.failureCode, forced };
  }
  if (!isCompleteScoreMap(outcome.scores)) return { verdict: "UNSURE", source: "RULE", reasonCode: "AI_UNAVAILABLE", failureCode: "schema", forced };
  const s = outcome.scores;
  const topCategory = top(s);
  const zt = new Set<string>([...HARD_FLOORS.zeroTolerance, ...cfg.strikes.zeroTolerance]);
  let violating: Category | undefined;
  for (const c of CATEGORIES) {
    const t = thresholdFor(cfg, input.contentType, c);
    if (t.violation !== null && s[c] >= t.violation && (violating === undefined || s[c] > s[violating])) violating = c;
  }
  if (violating) return { verdict: "VIOLATION", source: "AI", topCategory: violating, reasonCode: violating, zeroTolerance: zt.has(violating) };

  if (HARD_FLOORS.forceUnsure.unsupportedLanguage && input.unsupportedLanguage) forced.push("UNSUPPORTED_LANGUAGE");
  if (HARD_FLOORS.forceUnsure.mediaTimeout && input.mediaTimeout) forced.push("MEDIA_TIMEOUT");
  if (HARD_FLOORS.forceUnsure.resubmitAfterHuman && input.resubmitAfterHuman) forced.push("RESUBMIT_AFTER_HUMAN");
  const band = cfg.trustBands[input.trustBand].unsureIfAnyAbove;
  if (band !== null && CATEGORIES.some((c) => s[c] > band)) forced.push("TRUST_BAND_" + input.trustBand);
  if (input.hasExternalLink && cfg.forceUnsure.externalLinkIn.includes(input.contentType as never)) forced.push("EXTERNAL_LINK");
  const v = cfg.forceUnsure.extremeRatingVelocity;
  if (v.enabled && (input.rating === 1 || input.rating === 5) && (input.productReviewsLastHour ?? 0) > v.reviewsPerHour) forced.push("EXTREME_RATING_VELOCITY");
  for (const e of input.extraForceUnsure ?? []) forced.push(e);
  if (forced.length) return { verdict: "UNSURE", source: "RULE", reasonCode: forced[0], topCategory, forced };

  const allClean = CATEGORIES.every((c) => s[c] < thresholdFor(cfg, input.contentType, c).clean); // equal to `clean` is NOT clean (CLS-001)
  if (allClean) return { verdict: "CLEAN", source: "AI", topCategory };
  return { verdict: "UNSURE", source: "AI", topCategory };
}
