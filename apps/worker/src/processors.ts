import type { Job } from "bullmq";
import { QUEUES, createMailProvider, createS3Store, loadEnv, mediaBuckets, mediaJobSchema, moderationJobSchema, type QueueName } from "@rp/core";
import { prisma } from "@rp/db";
import { StubPurchaseLookup, createModerationProvider, markVerifiedBuyer } from "@rp/core";
import { sendAccountExistsEmail, sendClaimBusinessEmail, type ClaimEmailDeps, sendSellerInvitationEmail, sendVerificationEmail, type EmailDb, type EmailDbInvitations } from "./email";
import { reminderDelayMs, sendTransferCancelLinks, type TransferNotifyDb } from "./ownership-transfer-email";
import { markMediaFailed, processMedia, type MediaDb } from "./media";
import { applyClaimObservation, prepareClaimCheck, type CheckStore, type EgressResult } from "./verification/checks";
import { sendClaimNotice, type NotifyDb } from "./verification/notify";
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
let mailer: ReturnType<typeof createMailProvider> | undefined;
const getMail = () => (mailer ??= createMailProvider());
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
  [QUEUES.notifications]: async (job) => {
    const d = { db: prisma as unknown as EmailDb & EmailDbInvitations, mail: getMail() };
    const key = String(job.id);
    const data = (job.data ?? {}) as { tokenId?: string; userId?: string; invitationId?: string };
    let outcome = "SKIPPED";
    if (job.name === "user.email_verification_requested" && data.tokenId) outcome = await sendVerificationEmail(d, data.tokenId, key);
    else if (job.name === "user.registration_conflict" && data.userId) outcome = await sendAccountExistsEmail(d, data.userId, key);
    else if (job.name === "seller.invitation_created" && data.invitationId) outcome = await sendSellerInvitationEmail(d, data.invitationId, key);
    else if (job.name === "claim.business_email_token_requested" && data.tokenId) outcome = await sendClaimBusinessEmail(d as unknown as ClaimEmailDeps, data.tokenId, key);
    else if (job.name === "seller.ownership_transfer_requested" || job.name === "seller.ownership_transfer_reminder") {
      const transferId = String((data as { transferId?: string }).transferId ?? (job.data as { aggregateId?: string } | undefined)?.aggregateId ?? "");
      const requested = job.name === "seller.ownership_transfer_requested";
      if (transferId) {
        const r = await sendTransferCancelLinks({ db: prisma as unknown as TransferNotifyDb, mail: getMail() }, transferId, requested ? "REQUESTED" : "REMINDER", key);
        outcome = r.outcome;
        // T - 24 h reminder (SEL-024). The deterministic job id makes a retried or duplicate request schedule it once.
        const delay = requested && r.executeAfter ? reminderDelayMs(r.executeAfter, new Date()) : null;
        if (delay !== null) await getNotificationsQueue().add("seller.ownership_transfer_reminder", { transferId }, { jobId: `otx__${transferId}__REMINDER`, delay });
      }
    } else if (job.name.startsWith("claim.") || job.name === "seller.downgraded") {
      const id = (job.name === "seller.downgraded" ? (data as { sellerId?: string }).sellerId : (data as { claimId?: string }).claimId) ?? "";
      if (id) outcome = await sendClaimNotice({ db: prisma as unknown as NotifyDb, mail: getMail() }, job.name, id, key);
    }
    console.log(JSON.stringify({ msg: "notification.done", jobId: job.id, type: job.name, outcome })); // never the address, token or URL
  },
  // T-01 / ADR-0015: the core worker never touches the network for verification. Intake prepares the request for the isolated
  // egress group (`verification-egress`); the observation comes back on `verification-result` and is persisted here.
  [QUEUES.verification]: async (job) => {
    const claimId = String(((job.data ?? {}) as { claimId?: string }).claimId ?? "");
    if (!claimId) return;
    const req = await prepareClaimCheck(prisma as unknown as CheckStore, claimId);
    if (!req) { console.log(JSON.stringify({ msg: "claim.check.skipped", jobId: job.id, claimId })); return; }
    await getEgressQueue().add("verification.egress", req, { jobId: `egress__${job.id}`, attempts: 3, backoff: { type: "exponential", delay: 10_000 } });
  },
  [QUEUES.verificationResult]: async (job) => {
    const r = (job.data ?? {}) as Partial<EgressResult>;
    if (!r.claimId || !Array.isArray(r.observed)) return;
    const outcome = await applyClaimObservation(prisma as unknown as CheckStore, r.claimId, { observed: r.observed.filter((x) => typeof x === "string").slice(0, 5), error: r.error ?? null, ...(r.proofHost ? { proofHost: r.proofHost } : {}) });
    console.log(JSON.stringify({ msg: "claim.check.done", jobId: job.id, claimId: r.claimId, outcome })); // never domains' bodies or tokens
  },
};

let notificationsQueue: { add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<unknown> } | undefined;
export const setNotificationsQueue = (q: NonNullable<typeof notificationsQueue>) => { notificationsQueue = q; };
const getNotificationsQueue = () => { if (!notificationsQueue) throw new Error("notifications queue not configured"); return notificationsQueue; };

// Set by main.ts: enqueues to the egress queue (the only verification-network path).
let egressQueue: { add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<unknown> } | undefined;
export const setEgressQueue = (q: NonNullable<typeof egressQueue>) => { egressQueue = q; };
const getEgressQueue = () => { if (!egressQueue) throw new Error("egress queue not configured"); return egressQueue; };
