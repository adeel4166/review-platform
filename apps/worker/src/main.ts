import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@rp/db";
import { QUEUES, loadEnv, moderationJobSchema, type Env, type QueueName } from "@rp/core";
import { processors } from "./processors";
import { MODERATION_JOB_OPTIONS, escalateDeadLetter, isFinalFailure, type WorkerDb } from "./moderation";
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
  if (!q) queues.set(n, (q = new Queue(n, { connection, ...(n === QUEUES.moderation ? { defaultJobOptions: MODERATION_JOB_OPTIONS } : {}) })));
  return q;
};

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

console.log(JSON.stringify({ msg: "worker.started", queues: Object.keys(processors) }));

async function shutdown() {
  clearInterval(timer);
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([...queues.values()].map((q) => q.close()));
  await prisma.$disconnect();
  connection.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
