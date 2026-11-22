import { z } from "zod";

/** Queue names from ADR-0001 §4 and ADR-0006 (media-video is a separate deployment). */
export const QUEUES = {
  moderation: "moderation",
  media: "media",
  mediaVideo: "media-video",
  verification: "verification",
  /** T-01: core -> isolated egress worker (claim id, method, domain). Only the egress group consumes it. */
  verificationEgress: "verification-egress",
  /** T-01: egress worker -> core (raw observation). Core persists it. */
  verificationResult: "verification-result",
  notifications: "notifications",
  trust: "trust",
  maintenance: "maintenance",
  moderationDead: "moderation-dead",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Job payloads are shared zod schemas. Every job is idempotent and keyed by domain id + version/event id,
 * so at-least-once delivery is safe.
 */
export const moderationJobSchema = z.object({
  subjectType: z.enum(["REVIEW", "SELLER_REPLY", "COMMENT", "POST", "MEDIA"]),
  subjectId: z.string().min(1),
  version: z.number().int().nonnegative(),
  /** Backward compatible: payloads without a trigger are SUBMISSION (m4-m5-spec 16.3). */
  trigger: z.enum(["SUBMISSION", "EDIT", "USER_REPORT"]).default("SUBMISSION"),
});
/** Input shape: `trigger` is optional on the wire (defaults to SUBMISSION when parsed). */
export type ModerationJob = z.input<typeof moderationJobSchema>;

export const mediaJobSchema = z.object({
  assetId: z.string().min(1),
  step: z.enum(["VALIDATE", "VIRUS_SCAN", "SANITISE", "VARIANTS"]).default("VALIDATE"),
  // MVP processes all steps in one job; the `media.uploaded` outbox payload is just {assetId}.
});
export type MediaJob = z.infer<typeof mediaJobSchema>;

export const payloadSchemas = {
  [QUEUES.moderation]: moderationJobSchema,
  [QUEUES.media]: mediaJobSchema,
} as const;

/** Deterministic BullMQ jobId so duplicate enqueues collapse. */
export function jobId(...parts: Array<string | number>): string {
  return parts.join("__");
}

/**
 * M6 job payloads (spec §13): ids, enums and epoch-ms deadlines only. No text, PII or scores (OUT-007).
 * The allow-list test in queues.test.ts fails if a schema gains a free-text field.
 */
const id = z.string().min(1).max(64);
export const m6JobSchemas = {
  "moderation.assess": z.object({ caseId: id, subjectType: z.enum(["REVIEW", "SELLER_REPLY", "MEDIA"]), subjectId: id, contentVersion: z.number().int().nonnegative(), trigger: z.enum(["SUBMISSION", "EDIT", "USER_REPORT", "STAFF_FLAG", "STAFF_INITIATED"]) }).strict(),
  "moderation.rescan": z.object({ caseId: id, n: z.number().int().nonnegative() }).strict(),
  "moderation.rescan-failed": z.object({}).strict(),
  "moderation.media-ready": z.object({ assetId: id }).strict(),
  "moderation.hold-expire": z.object({ caseId: id, deadlineMs: z.number().int() }).strict(),
  "moderation.post-review-lapse": z.object({ caseId: id, deadlineMs: z.number().int() }).strict(),
  "moderation.bulk-apply": z.object({ bulkOperationId: id }).strict(),
  "maintenance.moderation-sweep": z.object({}).strict(),
  "notifications.dispatch": z.object({ eventId: id, type: z.string().max(64) }).strict(),
  "trust.signal": z.object({ eventId: id, type: z.string().max(64) }).strict(),
  "staff.anomaly-scan": z.object({}).strict(),
  "maintenance.break-glass-digest": z.object({}).strict(),
} as const;
