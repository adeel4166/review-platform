import type { Job } from "bullmq";
import { QUEUES, createS3Store, loadEnv, mediaBuckets, mediaJobSchema, moderationJobSchema, type QueueName } from "@rp/core";
import { prisma } from "@rp/db";
import { StubPurchaseLookup, createModerationProvider, markVerifiedBuyer } from "@rp/core";
import { markMediaFailed, processMedia, type MediaDb } from "./media";
import { processModeration, verifiedBuyerStore, type VerifiedBuyerDb, type WorkerDb } from "./moderation";

export type Processor = (job: Job) => Promise<void>;

let provider: ReturnType<typeof createModerationProvider> | undefined;
const getProvider = () => (provider ??= createModerationProvider({ MODERATION_PROVIDER: process.env.MODERATION_PROVIDER, MODERATION_API_KEY: process.env.MODERATION_API_KEY }));
// Stub order adapter (no records) until a real order/PurchaseProof integration exists (ADR-0008).
const purchases = new StubPurchaseLookup();
let storage: { store: ReturnType<typeof createS3Store>; buckets: ReturnType<typeof mediaBuckets> } | undefined;
export const getMediaDeps = () => {
  if (!storage) {
    const env = loadEnv(); // storage credentials come from env only
    storage = { store: createS3Store(env), buckets: mediaBuckets(env) };
  }
  return { db: prisma as unknown as MediaDb, ...storage };
};
export { markMediaFailed };
const getDb = () => prisma as unknown as WorkerDb;

/**
 * Moderation: AI-first (ADR-0005). Throws on provider failure so BullMQ retries; after the last retry
 * main.ts dead-letters the job and escalates the review to a human. Never auto-approves on error.
 * Media: validate by content, strip EXIF, build variants, READY/FAILED (media.ts).
 */
export const processors: Partial<Record<QueueName, Processor>> = {
  [QUEUES.moderation]: async (job) => {
    const p = moderationJobSchema.parse(job.data);
    const outcome = await processModeration(getDb(), getProvider(), p, {
      jobId: String(job.id),
      verifyBuyer: (id) => markVerifiedBuyer(verifiedBuyerStore(prisma as unknown as VerifiedBuyerDb), purchases, id),
    });
    console.log(JSON.stringify({ msg: "moderation.done", jobId: job.id, subject: p.subjectType, id: p.subjectId, outcome }));
  },
  [QUEUES.media]: async (job) => {
    const p = mediaJobSchema.parse(job.data);
    const outcome = await processMedia(getMediaDeps(), p.assetId);
    console.log(JSON.stringify({ msg: "media.done", jobId: job.id, assetId: p.assetId, outcome }));
  },
};
