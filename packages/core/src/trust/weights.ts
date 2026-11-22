/** Trust score v1 constants (ADR-0029). A change here is a new algorithmVersion and a full recompute. */
export const ALGORITHM_VERSION = "trust-v1";
export const BASE = 20;
import type { TrustBand } from "../moderation/config";
export type { TrustBand };
export const BAND_ORDER: readonly TrustBand[] = ["NEW", "LOW", "MEDIUM", "HIGH"];
export const BAND_LOW_MAX = 40; // LOW < 40 <= MEDIUM
export const BAND_MEDIUM_MAX = 70; // MEDIUM < 70 <= HIGH
export const MATURITY = { minAgeDays: 7, minActions: 3 } as const;
export const VOTE_WEIGHT: Readonly<Record<TrustBand, number>> = { NEW: 0, LOW: 0.5, MEDIUM: 1, HIGH: 1.5 };
export const RECENT_NEGATIVE_DAYS = 30;

export interface SignalRule { value: number; cap: number; halfLifeDays: number; perValue?: boolean }
/** Positive caps are maxima, negative caps are minima of the summed component. */
export const USER_SIGNAL_RULES: Readonly<Record<string, SignalRule>> = {
  VERIFIED_PURCHASE: { value: 4, cap: 20, halfLifeDays: 365 },
  REVIEW_PUBLISHED: { value: 2, cap: 20, halfLifeDays: 365 },
  HELPFUL_VOTE_RECEIVED: { value: 0.5, cap: 15, halfLifeDays: 365, perValue: true },
  REPORT_UPHELD: { value: 1, cap: 5, halfLifeDays: 180 },
  REPORT_REJECTED: { value: -2, cap: -10, halfLifeDays: 180 },
  CONTENT_ACTIONED_AGAINST: { value: -10, cap: -40, halfLifeDays: 180 },
  ENFORCEMENT_ACTION: { value: -15, cap: -50, halfLifeDays: 180 }, // WARNING -5 / SUSPENSION -30 via signal.value override
  VELOCITY_ANOMALY: { value: -10, cap: -30, halfLifeDays: 180 },
  NEAR_DUPLICATE_TEXT: { value: -10, cap: -30, halfLifeDays: 180 },
  DUPLICATE_PROOF_DETECTED: { value: -15, cap: -60, halfLifeDays: 365 },
  PROOF_REJECTED_FRAUD: { value: -25, cap: -60, halfLifeDays: 365 },
  LINKED_ACCOUNT_SUSPECTED: { value: -20, cap: -60, halfLifeDays: 365 },
  MALWARE_UPLOAD: { value: -25, cap: -60, halfLifeDays: 365 },
};
/** Components that share one cap (ADR table rows with a joint cap). */
export const USER_COMPONENT_OF: Readonly<Record<string, string>> = {
  DUPLICATE_PROOF_DETECTED: "PROOF_FRAUD", PROOF_REJECTED_FRAUD: "PROOF_FRAUD", LINKED_ACCOUNT_SUSPECTED: "PROOF_FRAUD", MALWARE_UPLOAD: "PROOF_FRAUD",
  VELOCITY_ANOMALY: "ANOMALY", NEAR_DUPLICATE_TEXT: "ANOMALY",
};
export const COMPONENT_CAP: Readonly<Record<string, number>> = { PROOF_FRAUD: -60, ANOMALY: -30 };
export const SELLER_SIGNAL_RULES: Readonly<Record<string, SignalRule>> = {
  SELLER_REPLY_REMOVED: { value: -5, cap: -20, halfLifeDays: 180 },
  VELOCITY_ANOMALY: { value: -10, cap: -30, halfLifeDays: 180 },
};
