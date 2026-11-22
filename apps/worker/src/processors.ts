import type { Job } from "bullmq";
import { QUEUES, createMailProvider, createS3Store, loadEnv, mediaBuckets, mediaJobSchema, moderationJobSchema, type QueueName } from "@rp/core";
import { prisma } from "@rp/db";
import { assertNoAutoVerify, createModerationProvider, parseOrderRefKeys } from "@rp/core";
import { sendAccountExistsEmail, sendClaimBusinessEmail, type ClaimEmailDeps, sendSellerInvitationEmail, sendVerificationEmail, type EmailDb, type EmailDbInvitations } from "./email";
import { reminderDelayMs, sendTransferCancelLinks, type TransferNotifyDb } from "./ownership-transfer-email";
import { markMediaFailed, processMedia, type MediaDb } from "./media";
import { createClamd } from "./media/clamd";
import { defaultVerifier } from "./media/verify";
import { demoteMedia, promoteMedia, type PublishDb, type CdnPurger } from "./media/publish";
import { assessProof, failClosedRedactor, finalizeProof, processProofFile, purgeProofFiles, sendProofNotice, type AssessDeps, type ProofDeps } from "./proofs";
import { applyClaimObservation, prepareClaimCheck, type CheckStore, type EgressResult } from "./verification/checks";
import { sendClaimNotice, type NotifyDb } from "./verification/notify";
import { processModeration, type WorkerDb } from "./moderation";

export type Processor = (job: Job) => Promise<void>;

let provider: ReturnType<typeof createModerationProvider> | undefined;
const getProvider = () => (provider ??= createModerationProvider({ MODERATION_PROVIDER: process.env.MODERATION_PROVIDER, MODERATION_API_KEY: process.env.MODERATION_API_KEY }));
let storage: { store: ReturnType<typeof createS3Store>; buckets: ReturnType<typeof mediaBuckets> } | undefined;
export const getMediaDeps = () => {
  if (!storage) {
    const env = loadEnv(); // storage credentials come from env only
    storage = { store: createS3Store(env), buckets: mediaBuckets(env) };
  }
  return { db: prisma as unknown as MediaDb, ...storage, scanner: getScanner(), verifier: defaultVerifier(process.env.MEDIA_EXIFTOOL_REQUIRED === "true"), alert: securityAlert };
};
let scanner: ReturnType<typeof createClamd> | undefined;
export const getScanner = () => (scanner ??= createClamd({ host: process.env.CLAMD_HOST ?? "127.0.0.1", port: Number(process.env.CLAMD_PORT ?? 3310) }));
/** security-channel alert: structured log line the platform's log shipper routes; never carries file content or user data. */
export const securityAlert = (kind: string, detail: Record<string, unknown>) => console.error(JSON.stringify({ msg: "security.alert", channel: "security-channel", kind, ...detail }));
// CDN purge is wired by DevOps (CDN_PURGE_TOKEN); until configured it logs the URLs so a demote never silently skips the purge.
const logPurger: CdnPurger = { purgeUrls: async (urls) => { console.log(JSON.stringify({ msg: "cdn.purge", count: urls.length })); } };
export const getPublishDeps = () => {
  const m = getMediaDeps();
  const env = loadEnv();
  return { db: prisma as unknown as PublishDb, store: m.store, buckets: { private: m.buckets.private, public: env.S3_BUCKET_PUBLIC }, cdn: logPurger, publicBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL ?? "", alert: securityAlert };
};
export { markMediaFailed };

/** ADR-0008: the label is only ever set by a staff decision. Refuse to start with the reserved auto-verify switch on (C-3). */
assertNoAutoVerify();
const orderRefKeys = () => parseOrderRefKeys(process.env.ORDER_REF_HMAC_KEYS);
export const getProofDeps = (): ProofDeps => {
  const m = getMediaDeps();
  return { db: prisma, store: m.store, buckets: m.buckets, redactor: failClosedRedactor, keys: orderRefKeys() };
};
// No ProofExtractor provider is configured yet: proofs reach the queue without hints (aiAssessment.skipped), never auto-decided.
export const getAssessDeps = (): AssessDeps => {
  const m = getMediaDeps();
  return { db: prisma, store: m.store, buckets: m.buckets, extractor: null, takeBudget: async () => true, keys: orderRefKeys() };
};
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
    const outcome = await processModeration(getDb(), getProvider(), p, { jobId: String(job.id) });
    console.log(JSON.stringify({ msg: "moderation.done", jobId: job.id, subject: p.subjectType, id: p.subjectId, outcome }));
  },
  [QUEUES.media]: async (job) => {
    if (job.name.startsWith("proof.")) {
      const d = getProofDeps();
      const data = (job.data ?? {}) as { fileId?: string; proofId?: string; rule?: string };
      let outcome = "SKIPPED";
      if (job.name === "proof.file_uploaded" && data.fileId) outcome = await processProofFile(d, data.fileId);
      else if (job.name === "proof.submitted" && data.proofId) outcome = await finalizeProof(d.db, data.proofId, new Date());
      else if (job.name === "proof.purge_requested" && data.proofId) outcome = await purgeProofFiles(d, data.proofId, "PROOF_ORIGINAL");
      console.log(JSON.stringify({ msg: "proof.media.done", jobId: job.id, type: job.name, outcome })); // ids and outcome only
      return;
    }
    if (job.name === "media.promote_requested" || job.name === "media.demote_requested") {
      const x = (job.data ?? {}) as { assetId?: string; caseId?: string; reason?: string };
      const r = !x.assetId ? "SKIPPED" : job.name === "media.promote_requested" ? (x.caseId ? await promoteMedia(getPublishDeps(), x.assetId, x.caseId) : "SKIPPED") : await demoteMedia(getPublishDeps(), x.assetId, x.reason ?? "UNSPECIFIED");
      console.log(JSON.stringify({ msg: "media.publish.done", jobId: job.id, type: job.name, outcome: r }));
      return;
    }
    const p = mediaJobSchema.parse(job.data);
    const outcome = await processMedia(getMediaDeps(), p.assetId);
    console.log(JSON.stringify({ msg: "media.done", jobId: job.id, assetId: p.assetId, outcome }));
  },
  [QUEUES.notifications]: async (job) => {
    const d = { db: prisma as unknown as EmailDb & EmailDbInvitations, mail: getMail() };
    const key = String(job.id);
    const data = (job.data ?? {}) as { tokenId?: string; userId?: string; invitationId?: string };
    let outcome = "SKIPPED";
    if (["proof.decided", "proof.expired", "review.removed", "review.verified_label_revoked"].includes(job.name)) {
      const n = (job.data ?? {}) as { proofId?: string; reviewId?: string; outcome?: string; enforcementId?: string; caseId?: string };
      const entityId = n.proofId ?? n.reviewId ?? "";
      if (entityId) outcome = await sendProofNotice({ db: prisma, mail: getMail() }, job.name, entityId, n, key);
      console.log(JSON.stringify({ msg: "notification.done", jobId: job.id, type: job.name, outcome }));
      return;
    }
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
    if (job.name === "proof.files_ready") {
      const proofId = String(((job.data ?? {}) as { proofId?: string }).proofId ?? "");
      if (proofId) console.log(JSON.stringify({ msg: "proof.assess.done", jobId: job.id, proofId, outcome: await assessProof(getAssessDeps(), proofId) }));
      return;
    }
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
