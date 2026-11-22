import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@rp/db";
import { assertIpHashKey, assertModerationProviderConfigured, MEDIA_PUT_TTL_SECONDS, QUEUES, loadEnv, mediaJobSchema, moderationJobSchema, type Env, type QueueName, systemClock } from "@rp/core";
import { expireStaleUploads } from "./media";
import { sweepQuarantine } from "./media/quarantine";
import { assertMediaSandbox } from "./media/sandbox";
import { reconcilePublication } from "./media/publish";
import { startMediaHealth } from "./media/health";
import { getMediaDeps, getPublishDeps, getScanner, securityAlert, markMediaFailed, processors, setEgressQueue, setNotificationsQueue, setSummaryQueue } from "./processors";
import { MODERATION_JOB_OPTIONS, escalateDeadLetter, isFinalFailure, type WorkerDb } from "./moderation";
import { sweepDueChecks, sweepExpiry, sweepGrace, type SweepStore } from "./verification/checks";
import { nullOldIpHashes, reconcileVoteCounts, sweepProofs } from "./proofs";
import { getProofDeps } from "./processors";
import { relayOnce, type OutboxStore } from "./outbox";

assertIpHashKey(); // SEC-M4-01: no default key; refuse to start without IP_HASH_KEY

// Without infra config (e.g. a preview with no Redis/MySQL) idle instead of crashing next to the web app.
let env: Env;
try {
  env = loadEnv();
} catch (e) {
  if (process.env.NODE_ENV === "production") throw e;
  console.warn(JSON.stringify({ msg: "worker.disabled", reason: (e as Error).message, hint: "copy .env.example to .env and run `pnpm infra:up` to enable background jobs" }));
  process.exit(0);
}
// M8-02: fail closed when MODERATION_PROVIDER is unset/mock/unsupported in production (names only in the log).
try {
  console.log(JSON.stringify({ msg: "moderation.provider", provider: assertModerationProviderConfigured({ MODERATION_PROVIDER: process.env.MODERATION_PROVIDER, MODERATION_API_KEY: process.env.MODERATION_API_KEY, NODE_ENV: process.env.NODE_ENV }) }));
} catch (e) {
  console.error(JSON.stringify({ msg: "worker.startup.refused", err: (e as Error).message }));
  process.exit(1);
}
// MED-047: parser sandbox self-test. With MEDIA_SANDBOX_REQUIRED (default in production/CI) a missing bwrap or reachable network exits 1.
try {
  const sb = await assertMediaSandbox(process.env);
  console.log(JSON.stringify({ msg: "media.sandbox", sandboxed: sb.sandboxed }));
} catch (e) {
  console.error(JSON.stringify({ msg: "worker.startup.refused", err: (e as Error).message }));
  process.exit(1);
}
// BullMQ workers require maxRetriesPerRequest: null
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const queues = new Map<QueueName, Queue>();
const getQueue = (n: QueueName) => {
  let q = queues.get(n);
  if (!q) queues.set(n, (q = new Queue(n, { connection, ...(n === QUEUES.moderation ? { defaultJobOptions: MODERATION_JOB_OPTIONS } : {}), ...(n === QUEUES.notifications ? { defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5000 } } } : {}), ...(n === QUEUES.verification || n === QUEUES.verificationEgress ? { defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 30_000 } } } : {}), ...(n === QUEUES.aiSummary ? { defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 60_000 } } } : {}), ...(n === QUEUES.media ? { defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnFail: false } } : {}) })));
  return q;
};

setNotificationsQueue({ add: (n, d, o) => getQueue(QUEUES.notifications).add(n, d, o) });
setSummaryQueue({ add: (n, d, o) => getQueue(QUEUES.aiSummary).add(n, d, o) });
setEgressQueue({ add: (n, d, o) => getQueue(QUEUES.verificationEgress).add(n, d, o) });

const store: OutboxStore = {
  fetchUnpublished: (limit) =>
    prisma.outboxEvent.findMany({ where: { publishedAt: null }, orderBy: { id: "asc" }, take: limit }),
  markPublished: async (ids) => {
    await prisma.outboxEvent.updateMany({ where: { id: { in: ids } }, data: { publishedAt: systemClock.now() } });
  },
};

const workers = Object.entries(processors).map(([name, fn]) => {
  const w = new Worker(name, (job, token) => fn!(job, token), { connection, concurrency: name === QUEUES.aiSummary ? 1 : env.WORKER_CONCURRENCY });
  w.on("failed", (job, err) => {
    console.error(JSON.stringify({ msg: "job.failed", queue: name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message }));
    if (name === QUEUES.media && job && isFinalFailure(job)) {
      // Retries exhausted (e.g. storage outage): surface FAILED on the asset instead of leaving it PROCESSING.
      const m = mediaJobSchema.safeParse(job.data);
      if (m.success) markMediaFailed(getMediaDeps(), m.data.assetId, err.name === "ScannerUnavailable" ? "SCAN_UNAVAILABLE" : "PROCESSING_ERROR").catch((e: Error) => console.error(JSON.stringify({ msg: "media.fail.mark.error", jobId: job.id, err: e.message })));
    }
    if (name !== QUEUES.moderation || !job || !isFinalFailure(job)) return;
    // Retries exhausted: park the job in the dead-letter queue and send the review to a human (fail closed).
    const payload = moderationJobSchema.safeParse(job.data);
    void (async () => {
      await getQueue(QUEUES.moderationDead).add("moderation.dead", { original: job.data, error: err.message.slice(0, 500), failedJobId: job.id }, { removeOnFail: false });
      if (payload.success) await escalateDeadLetter(prisma as unknown as WorkerDb, payload.data, err.message, String(job.id));
    })().catch((e: Error) => console.error(JSON.stringify({ msg: "moderation.deadletter.error", jobId: job.id, err: e.message })));
  });
  return w;
});

const timer = setInterval(() => {
  relayOnce(store, { add: (q, n, d, o) => getQueue(q).add(n, d, o) }).catch((e: Error) =>
    console.error(JSON.stringify({ msg: "outbox.relay.error", err: e.message })),
  );
}, env.OUTBOX_POLL_INTERVAL_MS);

// SEC-03: expire abandoned UPLOADING slots (older than the presign TTL).
const sweepTimer = setInterval(() => {
  expireStaleUploads(getMediaDeps(), MEDIA_PUT_TTL_SECONDS)
    .then((n) => { if (n) console.log(JSON.stringify({ msg: "media.upload_sweep", expired: n })); })
    .catch((e: Error) => console.error(JSON.stringify({ msg: "media.upload_sweep.error", err: e.message })));
}, env.UPLOAD_SWEEP_INTERVAL_MS);

// M3-05 maintenance sweepers (spec §7): due checks + monthly/daily re-verification, expiry, grace/downgrade. Idempotent, safe to overlap.
// M5: public bucket follows moderation. Reconcile every minute; ClamAV freshness + /healthz (INF-003) when this group runs media.
const mediaTimers = [
  setInterval(() => { reconcilePublication(getPublishDeps()).then((r) => { if (r.demoted || r.promoted) console.log(JSON.stringify({ msg: "media.reconcile", ...r })); }).catch((e: Error) => console.error(JSON.stringify({ msg: "media.reconcile.error", err: e.message }))); }, 60_000),
];
// SEC-M5-03: quarantine retention (30 days) + count alert, daily.
mediaTimers.push(setInterval(() => { const d = getMediaDeps(); sweepQuarantine({ store: d.store, buckets: d.buckets, alert: securityAlert }).then((r) => { if (r.deleted) console.log(JSON.stringify({ msg: "media.quarantine_sweep", ...r })); }).catch((e: Error) => console.error(JSON.stringify({ msg: "media.quarantine_sweep.error", err: e.message }))); }, 24 * 60 * 60_000));
const health = process.env.WORKER_HEALTH_PORT ? startMediaHealth(getScanner(), Number(process.env.WORKER_HEALTH_PORT), securityAlert) : null;
const sweepDb = prisma as unknown as SweepStore;
const logSweep = (name: string) => (r: unknown) => { if (r && JSON.stringify(r) !== "0" && JSON.stringify(r) !== '{"graceStarted":0,"expired":0}') console.log(JSON.stringify({ msg: `maintenance.${name}`, result: r })); };
const sweepErr = (name: string) => (e: Error) => console.error(JSON.stringify({ msg: `maintenance.${name}.error`, err: e.message }));
const claimTimers = [
  setInterval(() => { sweepDueChecks(sweepDb, { add: (n, d, o) => getQueue(QUEUES.verification).add(n, d, o) }).then(logSweep("claims-due-checks")).catch(sweepErr("claims-due-checks")); }, 60_000),
  setInterval(() => { sweepExpiry(sweepDb).then(logSweep("claims-expire")).catch(sweepErr("claims-expire")); }, 15 * 60_000),
  setInterval(() => { sweepGrace(sweepDb).then(logSweep("claims-grace")).catch(sweepErr("claims-grace")); }, 60 * 60_000),
];

// M4 maintenance (m4-m5-spec 2.1, 5.8): vote counter reconcile + 90-day ipHash nulling (daily), proof drafts/SLA/retention/purge (every 10 min).
const m4Timers = [
  setInterval(() => { reconcileVoteCounts(prisma).then(logSweep("vote-counts")).catch(sweepErr("vote-counts")); }, 24 * 60 * 60_000),
  setInterval(() => { nullOldIpHashes(prisma).then(logSweep("ip-hash-retention")).catch(sweepErr("ip-hash-retention")); }, 24 * 60 * 60_000),
  setInterval(() => { const { db, store, buckets } = getProofDeps(); sweepProofs({ db, store, buckets, originalRetention: process.env.PROOF_ORIGINAL_RETENTION === "APPEAL_WINDOW" ? "APPEAL_WINDOW" : "AT_DECISION" }).then(logSweep("proof-retention")).catch(sweepErr("proof-retention")); }, 10 * 60_000),
];

// M7 (SEC-M7-01): vote-ring freeze + burst exclusion every minute, trust decay nightly at 02:00 UTC. Deterministic job ids make overlap a no-op.
// Recompute on signal runs from the `trust.signal` outbox events and (for MALWARE_UPLOAD) directly from the media worker.
const trustQueue = () => getQueue(QUEUES.trust);
const trustTimers = [
  setInterval(() => {
    const minute = Math.floor(systemClock.now().getTime() / 60_000);
    trustQueue().add("trust.vote-freeze", {}, { jobId: `trust-vf__${minute}`, removeOnComplete: true }).catch(sweepErr("trust-vote-freeze"));
    trustQueue().add("trust.product-burst", {}, { jobId: `trust-pb__${minute}`, removeOnComplete: true }).catch(sweepErr("trust-product-burst"));
    const now = systemClock.now();
    if (now.getUTCHours() === 2 && now.getUTCMinutes() === 0) trustQueue().add("trust.nightly-decay", {}, { jobId: `trust-decay__${now.toISOString().slice(0, 10)}`, removeOnComplete: true }).catch(sweepErr("trust-decay"));
  }, 60_000),
];

// M8 (spec 25.2): maintenance.retention daily 03:30 UTC, maintenance.audit-export daily 04:00 UTC; deterministic job ids make overlap a no-op.
const m8Timers = [
  setInterval(() => {
    const now = systemClock.now(); const d = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === 3 && now.getUTCMinutes() === 30) getQueue(QUEUES.maintenance).add("maintenance.retention", {}, { jobId: `retention__${d}`, removeOnComplete: true }).catch(sweepErr("retention"));
    if (now.getUTCHours() === 4 && now.getUTCMinutes() === 0) getQueue(QUEUES.maintenance).add("maintenance.audit-export", {}, { jobId: `audit-export__${d}`, removeOnComplete: true }).catch(sweepErr("audit-export"));
  }, 60_000),
];

console.log(JSON.stringify({ msg: "worker.started", group: "core", queues: Object.keys(processors) }));

async function shutdown() {
  clearInterval(timer);
  clearInterval(sweepTimer);
  claimTimers.forEach(clearInterval);
  m4Timers.forEach(clearInterval);
  trustTimers.forEach(clearInterval);
  m8Timers.forEach(clearInterval);
  mediaTimers.forEach(clearInterval);
  health?.close();
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([...queues.values()].map((q) => q.close()));
  await prisma.$disconnect();
  connection.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
