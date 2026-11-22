import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@rp/db";
import { MEDIA_PUT_TTL_SECONDS, QUEUES, loadEnv, mediaJobSchema, moderationJobSchema, type Env, type QueueName } from "@rp/core";
import { expireStaleUploads } from "./media";
import { getMediaDeps, markMediaFailed, processors, setEgressQueue, setNotificationsQueue } from "./processors";
import { MODERATION_JOB_OPTIONS, escalateDeadLetter, isFinalFailure, type WorkerDb } from "./moderation";
import { sweepDueChecks, sweepExpiry, sweepGrace, type SweepStore } from "./verification/checks";
import { nullOldIpHashes, reconcileVoteCounts, sweepProofs } from "./proofs";
import { getProofDeps } from "./processors";
import { relayOnce, type OutboxStore } from "./outbox";

// Without infra config (e.g. a preview with no Redis/MySQL) idle instead of crashing next to the web app.
let env: Env;
try {
  env = loadEnv();
} catch (e) {
  if (process.env.NODE_ENV === "production") throw e;
  console.warn(JSON.stringify({ msg: "worker.disabled", reason: (e as Error).message, hint: "copy .env.example to .env and run `pnpm infra:up` to enable background jobs" }));
  process.exit(0);
}
// BullMQ workers require maxRetriesPerRequest: null
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const queues = new Map<QueueName, Queue>();
const getQueue = (n: QueueName) => {
  let q = queues.get(n);
  if (!q) queues.set(n, (q = new Queue(n, { connection, ...(n === QUEUES.moderation ? { defaultJobOptions: MODERATION_JOB_OPTIONS } : {}), ...(n === QUEUES.notifications ? { defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5000 } } } : {}), ...(n === QUEUES.verification || n === QUEUES.verificationEgress ? { defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 30_000 } } } : {}), ...(n === QUEUES.media ? { defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnFail: false } } : {}) })));
  return q;
};

setNotificationsQueue({ add: (n, d, o) => getQueue(QUEUES.notifications).add(n, d, o) });
setEgressQueue({ add: (n, d, o) => getQueue(QUEUES.verificationEgress).add(n, d, o) });

const store: OutboxStore = {
  fetchUnpublished: (limit) =>
    prisma.outboxEvent.findMany({ where: { publishedAt: null }, orderBy: { id: "asc" }, take: limit }),
  markPublished: async (ids) => {
    await prisma.outboxEvent.updateMany({ where: { id: { in: ids } }, data: { publishedAt: new Date() } });
  },
};

const workers = Object.entries(processors).map(([name, fn]) => {
  const w = new Worker(name, (job) => fn!(job), { connection, concurrency: env.WORKER_CONCURRENCY });
  w.on("failed", (job, err) => {
    console.error(JSON.stringify({ msg: "job.failed", queue: name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message }));
    if (name === QUEUES.media && job && isFinalFailure(job)) {
      // Retries exhausted (e.g. storage outage): surface FAILED on the asset instead of leaving it PROCESSING.
      const m = mediaJobSchema.safeParse(job.data);
      if (m.success) markMediaFailed(getMediaDeps(), m.data.assetId, "PROCESSING_ERROR").catch((e: Error) => console.error(JSON.stringify({ msg: "media.fail.mark.error", jobId: job.id, err: e.message })));
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

console.log(JSON.stringify({ msg: "worker.started", group: "core", queues: Object.keys(processors) }));

async function shutdown() {
  clearInterval(timer);
  clearInterval(sweepTimer);
  claimTimers.forEach(clearInterval);
  m4Timers.forEach(clearInterval);
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([...queues.values()].map((q) => q.close()));
  await prisma.$disconnect();
  connection.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
