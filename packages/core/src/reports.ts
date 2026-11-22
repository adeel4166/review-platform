/** Reporting rules (m4-m5-spec 4). */
export const REPORT_REASONS = ["SPAM", "FAKE_OR_MISLEADING", "CONFLICT_OF_INTEREST", "OFF_TOPIC", "HARASSMENT_OR_HATE", "SEXUAL_CONTENT", "VIOLENCE_OR_THREATS", "PERSONAL_INFORMATION", "INTELLECTUAL_PROPERTY", "ILLEGAL_CONTENT", "IMPERSONATION", "OTHER"] as const;
export type ReportReasonT = (typeof REPORT_REASONS)[number];
/** `reasonCode` for staff removal: the report reasons except OTHER, plus POLICY_OTHER. */
export const REMOVAL_REASON_CODES = [...REPORT_REASONS.filter((r) => r !== "OTHER"), "POLICY_OTHER"] as const;
export const REPORT_DETAILS_MAX = 1000;
export const REPORT_LIMIT_USER_PER_DAY = 20;
export const REPORT_LIMIT_IP_PER_DAY = 50;
/** NEW reporters carry no weight in prioritisation (F-9). */
export const reportWeightFor = (newAccount: boolean): 0 | 1 => (newAccount ? 0 : 1);
export const openReportKey = (target: { reviewId?: string | null; sellerReplyId?: string | null }): string =>
  target.reviewId ? `R:${target.reviewId}` : `S:${target.sellerReplyId}`;

import { createHmac } from "node:crypto";
/** Keyed hash of a client IP (never the raw address). The key comes from `IP_HASH_KEY`; a dev default keeps tests deterministic. */
export function hashIp(ip: string, key = process.env.IP_HASH_KEY ?? "dev-ip-hash-key"): string {
  return createHmac("sha256", key).update(ip).digest("hex");
}
