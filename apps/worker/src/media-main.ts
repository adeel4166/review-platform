import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@rp/db";
import { MEDIA_PUT_TTL_SECONDS, QUEUES, loadEnv, mediaJobSchema } from "@rp/core";
import { expireStaleUploads } from "./media";
import { reconcilePublication } from "./media/publish";
import { startMediaHealth } from "./media/health";
import { sweepQuarantine } from "./media/quarantine";
import { assertMediaSandbox } from "./media/sandbox";
import { getMediaDeps, getPublishDeps, getScanner, securityAlert, markMediaFailed, processors, setNotificationsQueue, setEgressQueue } from "./processors";
import { isFinalFailure } from "./moderation";

/**
 * INF-008 `media` worker group: ONLY the media queue (untrusted parsers: sharp, ffmpeg, pdftoppm). main.ts has already
 * refused to start if the AI key, SMTP URL or auth/2FA secrets are in the environment (groups.ts assertMediaEnv).
 */
try {
  const r = await assertMediaSandbox(process.env); // MED-047: exit 1 when required and bwrap/no-network is not proven
  console.log(JSON.stringify({ msg: "media.sandbox", sandboxed: r.sandboxed }));
} catch (e) {
  console.error(JSON.stringify({ msg: "worker.startup.refused", err: (e as Error).message }));
  process.exit(1);
}
const env = loadEnv();
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const mediaQueue = new Queue(QUEUES.media, { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnFail: false } });
// Proof/publish jobs never enqueue mail or egress work from this group; the setters keep the shared processors module satisfied.
setNotificationsQueue({ add: async () => undefined as never });
setEgressQueue({ add: async () => undefined as never });

const fn = processors[QUEUES.media]!;
const worker = new Worker(QUEUES.media, (job, token) => fn(job, token), { connection, concurrency: env.WORKER_CONCURRENCY });
worker.on("failed", (job, err) => {
  console.error(JSON.stringify({ msg: "job.failed", queue: QUEUES.media, jobId: job?.id, attempt: job?.attemptsMade, err: err.message }));
  if (job && isFinalFailure(job)) {
    const m = mediaJobSchema.safeParse(job.data);
    if (m.success) markMediaFailed(getMediaDeps(), m.data.assetId, err.name === "ScannerUnavailable" ? "SCAN_UNAVAILABLE" : "PROCESSING_ERROR").catch(() => undefined);
  }
});
const err = (name: string) => (e: Error) => console.error(JSON.stringify({ msg: `${name}.error`, err: e.message }));
const timers = [
  setInterval(() => { expireStaleUploads(getMediaDeps(), MEDIA_PUT_TTL_SECONDS).catch(err("media.upload_sweep")); }, env.UPLOAD_SWEEP_INTERVAL_MS),
  setInterval(() => { reconcilePublication(getPublishDeps()).catch(err("media.reconcile")); }, 60_000),
  setInterval(() => { const d = getMediaDeps(); sweepQuarantine({ store: d.store, buckets: d.buckets, alert: securityAlert }).catch(err("media.quarantine_sweep")); }, 24 * 60 * 60_000),
];
const health = process.env.WORKER_HEALTH_PORT ? startMediaHealth(getScanner(), Number(process.env.WORKER_HEALTH_PORT), securityAlert) : null;
console.log(JSON.stringify({ msg: "worker.started", group: "media", queues: [QUEUES.media] }));

async function shutdown() {
  timers.forEach(clearInterval);
  health?.close();
  await worker.close();
  await mediaQueue.close();
  await prisma.$disconnect();
  connection.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
