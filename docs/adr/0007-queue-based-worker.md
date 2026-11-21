# ADR-0007: Queue-based background worker and transactional outbox contract

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #24 (M1-T1) |
| **Related** | ADR-0001 §1/§4 (BullMQ + outbox chosen), ADR-0005 (moderation timers), ADR-0006 (media jobs), [moderation-pipeline.md §7](../architecture/moderation-pipeline.md#7-job-and-queue-design-bullmq), [media-pipeline.md](../architecture/media-pipeline.md), scaffold `apps/worker`, `packages/core/src/queues.ts` |

## Context

ADR-0001 chose **BullMQ on Redis plus a transactional outbox in MySQL** in a single table row. ADR-0005 and ADR-0006
then designed concrete moderation and media jobs. M1.5 (task #22) scaffolded the worker: a polling relay
(`apps/worker/src/outbox.ts`), zod payload schemas and deterministic job ids (`packages/core/src/queues.ts`), and stub processors.
Every feature milestone (M2 to M8) will add jobs, so the rules for *all* jobs need to be written down once. Reviewing the
scaffold against the draft data model turned up these gaps:

1. **Schema drift.** The scaffold's `OutboxEvent` uses `type` / `publishedAt` and table `outbox_events`. The M1.1 draft used
   `topic` / `dispatchedAt` / `attempts` / `lastError` and no table mapping.
2. **Multiple replicas.** The relay reads unpublished rows and then marks them, with no locking. Two worker replicas would publish the same rows.
   The deterministic `jobId` usually hides this, but only while the first job is still retained in Redis.
3. **Silent loss.** Unrouted event types are marked *published* and only logged, so a typo in an event name drops work without any alert.
4. **Single process.** Every processor runs in one process, but ADR-0006 requires `media-video` (ffmpeg) to run separately so it cannot starve moderation.

## Decision

### 1. MySQL is the source of truth. Redis is a rebuildable delivery mechanism

- Everything needed for correctness lives in MySQL: content status, deadlines (`holdExpiresAt`, `postReviewDueAt`, `slaDueAt`) and
  retention dates. BullMQ holds only *pointers to work* (ids plus versions).
- Every delayed job has a **DB-deadline sweeper** as backstop (ADR-0005 §4.2). Every "stuck" state (for example `PENDING` content
  older than 10 min with no running job) has a sweeper that re-emits it. **Losing Redis costs latency, never data.**
- Redis still runs with AOF persistence and `maxmemory-policy noeviction` (ADR-0001), to keep that latency low.

### 2. Only the outbox enqueues. The web app never talks to BullMQ

- Domain code emits events with `emit(tx, { type, aggregateType, aggregateId, payload })` from `packages/core`, **inside the same
  Prisma transaction** as the state change. The relay is the only producer of event-driven jobs.
- `apps/web` must not import `bullmq`. An ESLint `no-restricted-imports` rule enforces this. (The web app may still use Redis directly for rate limiting, ADR-0002.)
- Exceptions: worker processors may enqueue follow-up jobs directly (for example re-delaying `moderation.assess` while media is still
  processing), and repeatable schedules are registered by the worker (§7).

### 3. Outbox table contract

The canonical shape is in [`schema.draft.prisma`](../architecture/schema.draft.prisma) (`OutboxEvent`, table `outbox_events`). Column names
follow the scaffold: `id BIGINT`, `type`, `aggregateType`, `aggregateId`, `payload`, `createdAt`, `publishedAt`, `attempts`, `lastError`.
The scaffold lacks `aggregateType`, `attempts` and `lastError`, which M2 adds in an additive migration.

**Relay algorithm.** The relay runs in the `core` worker group (§6). The steps are:

```sql
-- in one short transaction (timeout 5 s)
SELECT id, type, aggregateId, payload FROM outbox_events
 WHERE publishedAt IS NULL AND attempts < :maxAttempts
 ORDER BY id LIMIT :batch
 FOR UPDATE SKIP LOCKED;                          -- MySQL 8: safe with N relay replicas
-- for each row: validate payload (zod) → queue.add(name = type, data, { jobId: "outbox__<id>" })
-- success → publishedAt = NOW(3); failure → attempts = attempts + 1, lastError = scrubbed message (≤ 1000 chars)
```

- **Unrouted or invalid events are failures, not successes.** Set `attempts = maxAttempts` with `lastError = 'unrouted'` / `'invalid_payload'`,
  and alert. The row stays in the table for diagnosis and replay. *(This changes the scaffold, which currently marks such rows published.)*
- Default `maxAttempts` is 10. A row at the cap triggers an alert and the relay skips it. An operator replays it with an audited admin
  script by resetting `attempts`.
- **Ordering is not guaranteed**, not even per aggregate, and handlers must not depend on it. Each handler reloads current state and guards on
  versions (§5).
- Poll interval `OUTBOX_POLL_INTERVAL_MS`: 2000 ms by default (local), **500 ms in production**. Target relay lag is p95 < 2 s.
- Published rows are deleted after 7 days by `maintenance.outbox-purge`.

### 4. Job payload contract

- Each queue/job has a **zod schema in `packages/core/src/queues.ts`**. It is validated by the relay before enqueue and again by the processor on consume.
- **Payloads contain only ids, versions and a W3C `traceparent`.** They never contain user text, file names, emails, OCR output or any
  other PII (threat model R-4). Payloads are capped at 4 KB. Processors load everything else from MySQL.
- A payload change must be backwards compatible for one deploy (add optional fields first), because jobs created by version N may be
  consumed by version N+1.

### 5. Idempotency (at-least-once everywhere)

1. **Enqueue:** a deterministic `jobId` (`outbox__<id>` from the relay, or a domain key such as `assess:<caseId>:<version>`) collapses duplicates.
   BullMQ deduplicates a `jobId` only while the job is retained, so **`removeOnComplete.age` (24 h) must stay above the maximum relay
   redelivery window**. Do not shorten it.
2. **State changes:** use conditional transitions (`UPDATE … WHERE id = ? AND status = ? AND version = ?`). Zero affected rows means
   "already done or superseded": succeed without side effects.
3. **External side effects** (email, AI calls that cost money, object deletes) pass the `jobId` as the provider idempotency key where
   supported, or record completion in MySQL before acknowledging.

### 6. Deployment groups (one codebase, several deployments)

`apps/worker` builds one image. The `WORKER_QUEUES` environment variable selects which processors a process runs, and
`OUTBOX_RELAY=true|false` selects whether it also relays.

| Group | `WORKER_QUEUES` | Relay | Why separate |
|---|---|---|---|
| `core` | `moderation,verification,notifications,trust,maintenance` | yes | I/O-bound, latency-sensitive |
| `media` | `media` | no | Memory-heavy image work (libvips, ClamAV) |
| `media-video` | `media-video` | no | CPU-heavy ffmpeg must not starve moderation (ADR-0006) |

Locally, a single process runs every queue (the scaffold default). Per-queue concurrency and rate limits follow
[moderation-pipeline.md §7.2](../architecture/moderation-pipeline.md#72-queues).

### 7. Retries, failure and scheduling

- **Defaults:** 5 attempts with exponential back-off (base 5 s). Every job type sets an explicit timeout. Validation and
  "cannot ever succeed" errors throw BullMQ `UnrecoverableError` so they are not retried.
- **Final failure:** the job lands in the failed set, which serves as the DLQ and is kept 14 days. An alert fires, and a **domain fallback**
  runs where one is defined. For moderation the fallback is always UNSURE, never approve (ADR-0005). Replaying failed jobs is an admin-only, audited operation.
- **Timers:** per-entity timers use delayed jobs, with the DB-deadline sweeper as backstop (ADR-0005).
- **Cron:** repeatable work uses BullMQ **job schedulers** (`upsertJobScheduler`, idempotent by scheduler id), registered at
  `core` start-up. Registering on every boot is safe.
- **Serialization:** we do not rely on queue-level per-entity serialization (BullMQ OSS has no groups). Conditional transitions (§5)
  are the concurrency control.

### 8. Operations

- Graceful shutdown on SIGTERM (already in the scaffold): stop polling, `worker.close()` waits for in-flight jobs, then disconnect.
- Metrics:
  - per-queue waiting/active/delayed/failed counts and oldest-waiting age
  - **outbox lag**, i.e. `NOW() - MIN(createdAt) WHERE publishedAt IS NULL`
  - rows at the attempt cap
  - job duration per type
- Alerts:
  - outbox lag > 60 s
  - any outbox row at the attempt cap
  - failed jobs > 20 in 10 min per queue
  - stalled-job rate
  - repeatable schedule missed for 3 runs
- OpenTelemetry: the relay copies `traceparent` into job data, so one trace spans request → outbox → job (ADR-0001).

## Alternatives considered

| Option | Why not |
|---|---|
| Enqueue directly from Server Actions (no outbox) | Not atomic with the DB commit. Either jobs are lost (crash after commit) or they run on rolled-back data (ADR-0001) |
| MySQL job table only (`SKIP LOCKED` workers, no Redis) | We would re-implement back-off, delays, rate limiting, schedulers and an ops UI ourselves. Redis is needed for rate limiting anyway |
| Change data capture (Debezium / binlog) instead of polling | Removes polling latency but adds Kafka-class infrastructure. Disproportionate at Phase 1 scale |
| Durable workflow engine (Temporal, Inngest, Trigger.dev) | Excellent for long multi-step flows, but it is another stateful platform or vendor to run and learn. Revisit if flows outgrow "event → idempotent job" (e.g. multi-day proof workflows with human steps) |
| BullMQ Pro (groups, per-entity ordering) | Paid licence. Conditional DB transitions already give us correctness without ordering |
| Managed queues (SQS / Cloudflare Queues) | Ties us to a cloud before hosting (T-1) is decided, and has weaker delayed/repeatable job support (ADR-0001) |

## Consequences

**Positive**

- One rule for every feature team: write state and an event in the same transaction, and keep handlers idempotent.
- Safe with any number of worker replicas. Redis loss degrades latency only.
- Failures are visible (cap, DLQ, alerts) instead of silently dropped.
- Heavy media work is isolated from latency-sensitive moderation.

**Negative / risks**

- Polling adds up to one interval of latency (500 ms in production) and constant light DB load. Mitigation: tiny indexed query, with back-off when idle.
- Holding row locks during `queue.add` makes the relay transaction depend on Redis latency. Mitigation: small batches and a 5 s transaction timeout.
- At-least-once delivery puts the burden of idempotency on every handler. Mitigation: a shared transition helper plus a test per handler that runs it twice (test-strategy).

## Follow-ups (M2, Backend Engineer)

- Add `aggregateType`, `attempts`, `lastError` to `packages/db` `OutboxEvent`, and switch the relay to the `SKIP LOCKED` claim with the attempt cap.
- Treat unrouted/invalid events as failures (§3). Validate payloads in the relay.
- Add `WORKER_QUEUES` / `OUTBOX_RELAY` to `packages/core/src/env.ts` and the worker entry point.
- Add the `no-restricted-imports: bullmq` lint rule for `apps/web`, the `emit(tx, …)` helper, the job-scheduler registration, the outbox purge, and the metrics and alerts in §8.
