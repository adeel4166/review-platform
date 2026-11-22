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
