import type { Job } from "bullmq";
import { QUEUES, mediaJobSchema, moderationJobSchema, type QueueName } from "@rp/core";

export type Processor = (job: Job) => Promise<void>;

/**
 * Skeleton processors. They validate the payload and log; real logic arrives with the
 * moderation (ADR-0005) and media (ADR-0006) feature tasks. Must stay idempotent.
 * Moderation must never auto-approve on error: throw so BullMQ retries / escalates.
 */
export const processors: Partial<Record<QueueName, Processor>> = {
  [QUEUES.moderation]: async (job) => {
    const p = moderationJobSchema.parse(job.data);
    console.log(JSON.stringify({ msg: "moderation.stub", jobId: job.id, subject: p.subjectType, id: p.subjectId }));
  },
  [QUEUES.media]: async (job) => {
    const p = mediaJobSchema.parse(job.data);
    console.log(JSON.stringify({ msg: "media.stub", jobId: job.id, assetId: p.assetId, step: p.step }));
  },
};
