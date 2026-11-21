import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { QUEUES } from "@rp/core";
import { runEgressCheck, type EgressRequest } from "./verification/checks";
import { createDnsResolver, createProductionFetcher } from "./verification/safe-fetch";

// Isolated verification-egress group (T-01). Env: REDIS_URL + VERIFY_DNS_SERVERS only (asserted in main.ts). No DB, storage or mail.
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const results = new Queue(QUEUES.verificationResult, { connection, defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5000 } } });
const dns = createDnsResolver();
const deps = { fetcher: createProductionFetcher(dns), dns };

const worker = new Worker(
  QUEUES.verificationEgress,
  async (job) => {
    const r = await runEgressCheck(deps, job.data as EgressRequest);
    if (!r.claimId) return;
    await results.add("verification.result", r, { jobId: `result__${job.id}` });
    console.log(JSON.stringify({ msg: "claim.egress.done", jobId: job.id, claimId: r.claimId, error: r.error })); // never bodies or tokens
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) || 2 },
);
worker.on("failed", (job, err) => console.error(JSON.stringify({ msg: "job.failed", queue: QUEUES.verificationEgress, jobId: job?.id, err: err.message })));

console.log(JSON.stringify({ msg: "worker.started", group: "verification-egress", queues: [QUEUES.verificationEgress] }));

async function shutdown() {
  await worker.close();
  await results.close();
  connection.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
