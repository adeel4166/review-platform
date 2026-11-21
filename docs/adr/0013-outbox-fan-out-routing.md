# ADR-0013: Outbox fan-out routing and domain job keys (refines ADR-0007)

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #25 (M1-T2) |
| **Related** | ADR-0007 §3–§5 (refined here), [job-catalogue.md](../architecture/job-catalogue.md) §1–§2, scaffold `apps/worker/src/outbox.ts`, `packages/core/src/queues.ts` |

## Context

ADR-0007 relays each outbox row to **one** queue. The job name is the event type and the job id is `outbox__<id>`.
The moderation and media designs need more than that:

- `moderation.decided` must reach both `notifications` and `trust`. `media.rejected` must reach notifications,
  moderation and, for malware, trust.
- Timer events (`moderation.hold_started`) must become **delayed** jobs.
- The job catalogue keys jobs by domain identity, for example `assess__<caseId>__<version>`. That collapses duplicate
  work even when a sweeper re-emits it as a **new** outbox row. `outbox__<id>` does not.
- Earlier drafts used `:` in job ids. BullMQ reserves that character, and the scaffold's `jobId()` helper uses `__`.

## Decision

1. `routes: Record<EventType, Route[]>` with `Route = { queue, job, key(payload) → string, delayUntil?(payload) → Date }`.
   Every route of an event must have a schema in `packages/core`.
2. For each row the relay validates the event payload. It then adds one job per route:
   `queue.add(route.job, { v, eventId, traceparent, ...payload }, { jobId: route.key(payload), delay: max(0, delayUntil − now) })`.
   It sets `publishedAt` only when **every** add succeeds. On a partial failure it increments `attempts` and retries
   the whole row; the adds are idempotent through their job ids.
3. Job ids are domain keys built with `jobId()` (`__` separator, no `:`). `outbox__<id>` remains the default only for
   routes that declare no key.
4. Job name ≠ event type. Processors dispatch on `job.name`, and payload schemas are keyed by job name.

## Alternatives considered

| Option | Why not |
|---|---|
| One outbox row per consumer, written by the domain code | Couples domain code to its consumers. Every new consumer would mean editing every emitter |
| A fan-out job that re-enqueues | An extra hop. It also breaks the "only the relay enqueues event-driven jobs" rule |
| Keep `outbox__<id>` ids | Sweeper re-emits would duplicate work. Correctness would then depend entirely on DB guards, and side effects such as AI cost would run twice |

## Consequences

**Positive:** consumers are added in one routing table. Timers are punctual through delayed jobs. Duplicate
triggers collapse.

**Negative:** a row with N routes costs N Redis calls while the relay holds its lock. Mitigation: routes per event
are ≤ 3, and the batch size is tuned. A domain key collision would drop legitimate work, so keys must include the
version or deadline (job-catalogue §4).

## Follow-ups

- M2 (Backend Engineer): implement it in `apps/worker/src/outbox.ts` and add relay unit tests for fan-out, partial
  failure, delay and key collisions. Migrate the scaffold schemas per job-catalogue §8.
