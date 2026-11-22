/** Notification types (ADR-0031). No MESSAGE_* types in Phase 1 (SCOPE-001). */
export const NOTIFICATION_TYPES = [
  "CONTENT_HELD", "CONTENT_REJECTED", "CONTENT_REMOVED", "CONTENT_RESTORED", "MEDIA_REJECTED", "APPEAL_RECEIVED", "APPEAL_DECIDED",
  "ENFORCEMENT_ISSUED", "SECURITY_ALERT", "PROOF_VERIFIED", "PROOF_REJECTED", "VERIFIED_LABEL_REVOKED",
  "REVIEW_PUBLISHED", "REVIEW_VOTED_HELPFUL", "SELLER_REPLIED", "NEW_FOLLOWER", "FOLLOWED_PRODUCT_REVIEWED", "REPORT_RESOLVED",
  "CLAIM_VERIFIED", "CLAIM_REJECTED", "SYSTEM_ANNOUNCEMENT",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const CHANNELS = ["IN_APP", "EMAIL"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Statements of reasons and security alerts must always arrive; delivered on both channels. */
export const MANDATORY_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "CONTENT_HELD", "CONTENT_REJECTED", "CONTENT_REMOVED", "CONTENT_RESTORED", "MEDIA_REJECTED", "APPEAL_RECEIVED", "APPEAL_DECIDED",
  "ENFORCEMENT_ISSUED", "SECURITY_ALERT", "PROOF_VERIFIED", "PROOF_REJECTED", "VERIFIED_LABEL_REVOKED",
]);
export const isMandatory = (t: NotificationType) => MANDATORY_TYPES.has(t);
/** Types grouped per day instead of one row per event. */
export const DAILY_GROUPED: ReadonlySet<NotificationType> = new Set<NotificationType>(["REVIEW_VOTED_HELPFUL", "NEW_FOLLOWER"]);
