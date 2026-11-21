# Background Job Catalogue: Moderation and Media

| | |
|---|---|
| **Status** | Draft for review (task #25, M1-T2) |
| **Owner** | Software Architect |
| **Decision records** | [ADR-0007](../adr/0007-queue-based-worker.md) (worker and outbox contract) · [ADR-0012](../adr/0012-media-job-decomposition.md) (media step jobs and verified staging copy) · [ADR-0013](../adr/0013-outbox-fan-out-routing.md) (fan-out routing and domain job keys) |
| **Related** | [moderation-lifecycle.md](./moderation-lifecycle.md) · [moderation-pipeline.md](./moderation-pipeline.md) §2–§4 · [media-pipeline.md](./media-pipeline.md) · scaffold `packages/core/src/queues.ts`, `apps/worker/src/outbox.ts` |
| **Replaces** | The job tables in moderation-pipeline.md §7.3/§7.4 and media-pipeline.md §8. Those sections now point here |

This is the authoritative list of event types, jobs, payloads, job ids and retry policies for moderation and
media. Seller-claim and proof jobs (`verification.*`) keep their definitions in ADR-0008 and moderation-pipeline
§6.3. They follow the conventions in §1–§3. Ownership-check execution is split over `verification` → `verification-egress` → `verification-result` ([verification-egress.md](../security/verification-egress.md)).
M3b additions (2FA alerts, ownership-change jobs, business-email MX lookup and token mail, seller-reply moderation) are
listed in [m3b-spec.md §8](./m3b-spec.md#8-job-catalogue-additions) and follow the same conventions.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Job name | `<queue>.<verb>` (e.g. `media.scan`). It is the BullMQ job **name**, and it is distinct from the outbox **event type** that triggers it (ADR-0013) |
| Job id | Always built with `jobId(...parts)` from `packages/core` (`__` separator), e.g. `assess__<caseId>__<v>`. **No `:` in custom ids.** BullMQ uses `:` as its Redis key separator and rejects most custom ids that contain it. The `x:y:z` ids in earlier drafts are replaced by this table |
| Payload | One zod schema per job in `packages/core/src/queues.ts`. Contains **only ids, versions, enums, timestamps, hashes**, plus the envelope (§1.1). No user text, file names, emails or metadata values (ADR-0007 §4, threat R-4). ≤ 4 KB |
| Validation | Relay validates the **event** payload before enqueueing. The processor validates the **job** payload on consume. A failure is `UnrecoverableError` (no retry) and raises an alert |
| Idempotency | Deterministic job id (enqueue) + conditional DB transition (effect) + "copy then delete" (objects). Every handler is tested by running it twice (test-strategy §4) |
| Timeouts | BullMQ has no per-job timeout option. Each processor creates an `AbortSignal.timeout(ms)` and passes it to every I/O call and child process. On timeout the processor throws a retryable `JobTimeoutError` |
| Retention | `removeOnComplete: { age: 24 h }` (it must stay above the relay redelivery window, ADR-0007 §5). `removeOnFail: { age: 14 d }`: the failed set is the DLQ |

### 1.1 Envelope and shared types

```ts
// packages/core/src/queues.ts (target shape; the scaffold is updated in M2, see §8)
const id = z.string().min(1).max(32);                      // cuid
const envelope = {
  v: z.literal(1),                                         // payload schema version
  eventId: z.string().regex(/^\d+$/).optional(),           // OutboxEvent.id (BIGINT as string) when relay-created
  traceparent: z.string().max(55).optional(),              // W3C trace context
};
const SubjectType = z.enum(["REVIEW", "SELLER_REPLY", "COMMENT", "POST", "MEDIA"]); // ModerationCase arc
const Trigger = z.enum(["SUBMISSION", "EDIT", "USER_REPORT", "AI_RESCAN", "STAFF_INITIATED"]); // ModerationTrigger
const isoTime = z.string().datetime();                     // UTC, ms precision
```

---

## 2. Event types and routes

The relay maps one outbox row to **one or more** jobs (fan-out, ADR-0013). A route declares the queue, job name,
domain key and an optional `delayUntil`. An event without a route is a relay failure, not a silent skip (ADR-0007 §3).

| Event type (`OutboxEvent.type`) | Emitted by | Event payload | Routes → job (queue) |
|---|---|---|---|
| `review.submitted`, `comment.submitted`, `post.submitted`, `seller_reply.submitted` | T1 | `{caseId, subjectType, subjectId, contentVersion, trigger:"SUBMISSION"}` | `moderation.assess` (moderation) |
| `review.edited`, `comment.edited`, `post.edited`, `seller_reply.edited` | T14, T20, R1 | same, `trigger:"EDIT"` | `moderation.assess` |
| `media.standalone_ready` | `media.image` final step for `AVATAR`/`SELLER_LOGO`/`PRODUCT_IMAGE` (creates the case in the same tx) | same, `subjectType:"MEDIA"` | `moderation.assess` |
| `moderation.rescan_requested` | T11, staff "re-scan", `moderation.rescan-failed` fan-out | same + `rescanNo` | `moderation.rescan` (moderation) |
| `moderation.decided` | every transition that writes a decision | `{caseId, decisionId, transition, subjectType, subjectId}` | `notifications.dispatch` (notifications), `trust.signal` (trust) |
| `moderation.hold_started` | T4, R4 | `{caseId, holdExpiresAt}` | `moderation.hold-expire`, **delayed until** `holdExpiresAt` |
| `moderation.post_review_opened` | T2, R2 | `{caseId, postReviewDueAt, lapseAt}` | `moderation.post-review-lapse`, **delayed until** `lapseAt` |
| `moderation.bulk_requested` | bulk Server Action | `{bulkOperationId}` | `moderation.bulk-apply` |
| `content.deleted` | T13, T19 | `{subjectType, subjectId}` | `trust.signal` |
| `appeal.submitted` | A1 | `{appealId, caseId}` | `notifications.dispatch` |
| `appeal.decided` | A3–A5 | `{appealId, caseId, outcome}` | `notifications.dispatch`, `trust.signal` |
| `media.uploaded` | `confirmUpload` (web) | `{assetId}` | `media.scan` (media) |
| `media.image_requested` | `media.scan` (photo, document) | `{assetId, sha256, processingRev}` | `media.image` (media) |
| `media.transcode_requested` | `media.scan` (video) | `{assetId, sha256, processingRev}` | `media.transcode` (media-video) |
| `media.processed` | `media.image` / `media.transcode` final tx | `{assetId}` | `moderation.media-ready` |
| `media.rejected`, `media.failed` | any media step | `{assetId, reason}` (`MediaFailureReason`) | `notifications.dispatch` (`MEDIA_REJECTED`), `moderation.media-ready`, and `trust.signal` for `MALWARE` |
| `media.promote_requested` | transitions into `PUBLISHED` (one row per attached asset) | `{assetId, caseId, decisionId}` | `media.promote` |
| `media.demote_requested` | transitions out of `PUBLISHED`, author delete, erasure, avatar replace | `{assetId, reason, decisionId?}` | `media.demote` |
| `media.purge_requested` | `maintenance.media-retention`, erasure | `{assetId, rule}` | `media.purge` |

`config.activated` is **not** an outbox event. After commit the web app publishes a best-effort Redis pub/sub hint,
and workers re-read the `ACTIVE` config every 60 s, which is the guarantee (pipeline §5.1).

---

## 3. Retry policy

### 3.1 Error classes

| Class | Thrown for | BullMQ behaviour |
|---|---|---|
| `RetryableError` (default for unknown errors) | Network, 5xx, 429, DB deadlock or lock timeout, storage errors, `JobTimeoutError`, scanner unreachable | Retried with the job's back-off until `attempts` is exhausted |
| `UnrecoverableError` (BullMQ) | Invalid payload, a file that can never pass (type, size, codec, corrupt, malware), entity missing | Fails immediately, with no retry |
| `DelayedError` (BullMQ) after `job.moveToDelayed(ts, token)` | Waiting for a dependency (media still processing) | Re-delayed **without** consuming an attempt |
| *No-op success* | The guard finds the work done or superseded (status already changed, newer version, legal hold) | Completes, with no side effects and no error |

**Last-attempt fallback runs in-band.** When `job.attemptsMade + 1 === job.opts.attempts` and the error is
retryable, the processor does **not** throw. It applies the domain fallback itself, for example T4 *UNSURE*
(`AI_UNAVAILABLE`) or `FAILED (SCAN_UNAVAILABLE)`. This makes the fallback part of a normal, transactional job run
instead of a `failed` event listener that could itself crash. The sweepers in §5 are the backstop when even that does
not happen (crash or stall on the last attempt).

### 3.2 Named back-off strategies

Implemented once as the worker's `settings.backoffStrategy` (`backoff: { type: "<name>" }`). The delay is chosen by
retry number:

| Name | Delays | Notes |
|---|---|---|
| `ai` | 5 s, 20 s, 60 s | Uses `max(delay, Retry-After)` on 429. With the default `ai.maxAttempts = 3`, only **5 s and 20 s** are used. Worst case: 25 s of back-off plus 3 × 15 s provider timeout ≈ 70 s. *This corrects pipeline §2.3, which counted a third back-off that 3 attempts never reach* |
| `scanner` | 1 m, 5 m, 15 m, 30 m, 1 h, 1 h, 1 h, 1 h | **9 attempts** (1 + 8 retries), Σ 5 h 51 min ≈ the 6 h fail-closed budget. *This corrects media-pipeline §8, which listed 8 attempts for 8 delays* |
| `exp10s` / `exp30s` / `exp1m` | base × 2ⁿ⁻¹, ±20 % jitter, capped at 10 min | General purpose |

### 3.3 Final failure, DLQ and replay

- A failed job stays in the failed set for 14 days and raises an alert, by default "failed > 20 in 10 min per queue".
  The jobs marked **page** below alert on every failure.
- Ops replay a job with `job.retry()` through an admin-only script. Each replay writes `AuditLog(action = "ops.job.replay")`.
  The deterministic job id stops a replay and a new trigger from both running.
- **Stalls:** `maxStalledCount = 1`. A worker crash re-runs the job once. A second stall fails it, for example a
  decoder killed for using too much memory. The sweepers in §5 then apply the fallback.

---

## 4. Job definitions

### 4.1 Moderation queue (`core` deployment)

| Job | Trigger | Job id | Attempts / back-off | Timeout | Retryable | Unrecoverable / no-op | Final failure (in-band) |
|---|---|---|---|---|---|---|---|
| `moderation.assess` | `*.submitted`, `*.edited`, `media.standalone_ready` | `assess__<caseId>__<contentVersion>` | 3 (`ai.maxAttempts`) / `ai` | 60 s | provider timeout, 5xx, 429, network; DB | Schema-invalid response or unsupported language → **UNSURE in-band** (not thrown). Case resolved or version superseded → no-op | T4 (RULE / ESCALATE / UNSURE, `AI_UNAVAILABLE`, `failureCode`) |
| `moderation.rescan` | `moderation.rescan_requested` | `rescan__<caseId>__<rescanNo>` | 3 / `ai` | 60 s | as above | as above | State unchanged. A live item stays live; T15 needs a VIOLATION. Alert |
| `moderation.media-ready` | `media.processed`, `media.rejected`, `media.failed` | `media-ready__<assetId>` | 3 / `exp10s` | 10 s | Redis, DB | No waiting assess job → no-op | Ignore. `moderation.assess` polls anyway |
| `moderation.hold-expire` | `moderation.hold_started` (delayed) | `hold-expire__<caseId>__<holdExpiresAt epoch ms>` | 5 / `exp30s` | 30 s | DB | Case resolved, superseded or deadline changed → no-op | Sweeper applies T7 / R7 |
| `moderation.post-review-lapse` | `moderation.post_review_opened` (delayed) | `pr-lapse__<caseId>__<lapseAt epoch ms>` | 5 / `exp30s` | 30 s | DB | as above | Sweeper applies T10 |
| `moderation.bulk-apply` | `moderation.bulk_requested` | `bulk__<bulkOperationId>` | 3 / `exp30s` | 5 min | DB | Per item: resolved, leased, COI, legal hold → `skipped:<reason>` | Partial result recorded and alert. A retry resumes and skips applied items |
| `moderation.rescan-failed` | scheduler, every 10 min | scheduler id `rescan-failed` | 1 | 5 min | — | Breaker open → no-op | Next run |

**Waiting for media** (pipeline §2.4). While any attached asset is `UPLOADING`/`PROCESSING`, `moderation.assess`
calls `job.moveToDelayed(now + 30 s)` and throws `DelayedError`. No attempt is consumed. `moderation.media-ready`
promotes the delayed job (`Job.promote()`) as soon as the asset settles, so the 30 s poll is only a fallback. After
`media.maxWaitMinutes` (30), measured from `case.createdAt`, the assess job applies T4 with `MEDIA_TIMEOUT`.

**AI pending guard (fix).** Pipeline §2.3 forces UNSURE when a `PENDING` case has had no decision for 10 min. That
would fire before the 30 min media wait ends. The guard deadline is therefore:
`createdAt + ai.maxPendingMinutes` when no attached media is pending, and
`createdAt + media.maxWaitMinutes + ai.maxPendingMinutes` (40 min) otherwise.

### 4.2 Media queues (`media` and `media-video` deployments)

```mermaid
flowchart LR
  C[confirmUpload<br/>UPLOADING→PROCESSING<br/>outbox media.uploaded] --> S
  subgraph mediaQ [media queue]
    S[media.scan<br/>VALIDATE · banned hash · VIRUS_SCAN<br/>copy verified bytes → private staging<br/>delete ingest]
    I[media.image<br/>SANITIZE · resize · thumbnails<br/>pHash · READY]
    P[media.promote]
    D[media.demote]
    G[media.purge]
  end
  subgraph mediaVideo [media-video queue]
    T[media.transcode<br/>probe · 720p H.264 · verify<br/>poster + poster_thumb · frames · READY]
  end
  S -- photo / document<br/>media.image_requested --> I
  S -- video<br/>media.transcode_requested --> T
  I -- media.processed --> M[moderation.media-ready<br/>or media.standalone_ready → moderation.assess]
  T -- media.processed --> M
  S -. REJECTED / FAILED<br/>media.rejected / media.failed .-> N[notifications + parent effect]
  I -.-> N
  T -.-> N
  M --> X{parent → PUBLISHED?}
  X -- media.promote_requested --> P
```

| Job | Trigger | Job id | Attempts / back-off | Timeout | Retryable | Unrecoverable → result | Final failure (in-band) |
|---|---|---|---|---|---|---|---|
| `media.scan` | `media.uploaded` | `scan__<assetId>` | **9 / `scanner`** | 2 min | clamd unreachable or timeout, storage 5xx, DB | Type not allowed or mismatch, polyglot, too large → `REJECTED (TYPE_NOT_ALLOWED / TYPE_MISMATCH / TOO_LARGE)`; banned hash → `REJECTED (BANNED_HASH)`; **infected** → quarantine + `REJECTED (MALWARE)`; ingest object missing → `REJECTED (NOT_CONFIRMED)` | `FAILED (SCAN_UNAVAILABLE)`, fail closed. Notify uploader. Parent proceeds without it |
| `media.image` | `media.image_requested` | `image__<assetId>__r<processingRev>` | 3 / `exp30s` | 60 s | storage 5xx, DB, `JobTimeoutError` | Decode error → `REJECTED (CORRUPT)`; > 50 MP → `REJECTED (TOO_MANY_PIXELS)`; staging sha256 ≠ payload sha256 → `FAILED (PROCESSING_ERROR)` + **security alert** (tampering or corruption) | `FAILED (PROCESSING_ERROR)` |
| `media.transcode` | `media.transcode_requested` | `transcode__<assetId>__r<processingRev>` | 3 / `exp1m` | 5 min | storage, DB, `JobTimeoutError` (node pressure) | ffprobe checks → `REJECTED (TOO_LONG / UNSUPPORTED_CODEC / CORRUPT / TOO_MANY_PIXELS)`; sha256 mismatch as above | `FAILED (PROCESSING_ERROR)` |
| `media.promote` | `media.promote_requested` | `promote__<assetId>__<decisionId>` | 5 / `exp10s` | 60 s | storage | Asset not `READY`, not scanned, or parent no longer `PUBLISHED` → no-op | Alert (content live without its media) |
| `media.demote` | `media.demote_requested` | `demote__<assetId>__<decisionId or reason>` | **10 / `exp10s`** (cap 10 min) | 60 s | storage, CDN purge API | Already private → no-op (the CDN purge still runs) | **Page on-call**. Content must not stay public |
| `media.purge` | `media.purge_requested` | `purge__<assetId>` | 5 / `exp1m` | 60 s | storage, CDN | `legalHold = true` → no-op (logged `SKIPPED`) | Alert. The next retention sweep re-emits it |

**Thumbnails and resizing are one job.** `media.image` decodes once with libvips and writes every variant from that
single decode: `thumb` 320 px (the thumbnail), `medium` 960, `large` 1920 and `large_jpg`. Each variant gets its
own entry in the `VARIANTS` log row. A separate thumbnail job would decode untrusted input a second time and add a
hop without making anything more reliable. For video, `poster` and `poster_thumb` come from the transcoded output
(trusted bytes), inside `media.transcode`.

**Concurrency and resources.** `media`: 4 per process, memory limit sized for 50 MP decodes, clamd sidecar.
`media-video`: 1–2 per process, `lockDuration` 60 s, and ffmpeg runs as a child process with no network and cgroup
limits, so the event loop keeps renewing the lock (media-pipeline §4.3).

### 4.3 Notifications and trust (`core` deployment)

| Job | Trigger | Job id | Attempts / back-off | Timeout | Notes |
|---|---|---|---|---|---|
| `notifications.dispatch` | `moderation.decided`, `appeal.*`, `media.rejected/failed` | `notif__<eventId>` | 5 / `exp30s` | 30 s | Resolves recipients from the event. Writes the in-app row first (idempotent on `(recipientId, groupKey)`). Email uses `jobId` as the provider idempotency key. Erased or unsubscribed recipient → no-op. Mandatory types (`CONTENT_*`, `MEDIA_REJECTED`, `APPEAL_*`) ignore preferences |
| `trust.signal` | `moderation.decided`, `appeal.decided`, `content.deleted`, `media.rejected (MALWARE)` | `trust__<eventId>` | 5 / `exp30s` | 30 s | Appends a `TrustSignal`; recompute is debounced per subject. A5/T19 rules (no strike for `HOLD_EXPIRED`, …) are applied here |

### 4.4 Payload schemas

```ts
export const moderationAssess = z.object({ ...envelope,
  caseId: id, subjectType: SubjectType, subjectId: id,
  contentVersion: z.number().int().positive(), trigger: Trigger });
export const moderationRescan = moderationAssess.extend({ rescanNo: z.number().int().min(1).max(10) });
export const moderationMediaReady = z.object({ ...envelope, assetId: id });
export const moderationHoldExpire = z.object({ ...envelope, caseId: id, holdExpiresAt: isoTime });
export const moderationPostReviewLapse = z.object({ ...envelope, caseId: id, postReviewDueAt: isoTime, lapseAt: isoTime });
export const moderationBulkApply = z.object({ ...envelope, bulkOperationId: z.string().min(1).max(32) });

export const mediaScan = z.object({ ...envelope, assetId: id });
export const mediaImage = z.object({ ...envelope, assetId: id,
  sha256: z.string().regex(/^[0-9a-f]{64}$/), processingRev: z.number().int().min(1) });
export const mediaTranscode = mediaImage;
export const mediaPromote = z.object({ ...envelope, assetId: id, caseId: id, decisionId: id });
export const mediaDemote = z.object({ ...envelope, assetId: id, decisionId: id.optional(),
  reason: z.enum(["MODERATION", "AUTHOR_DELETE", "ERASURE", "REPLACED"]) });
export const mediaPurge = z.object({ ...envelope, assetId: id,
  rule: z.enum(["RETENTION_REJECTED", "RETENTION_DELETED", "ORPHAN", "REPLACED", "ERASURE", "QUARANTINE"]) });

export const notificationsDispatch = z.object({ ...envelope, eventId: z.string().regex(/^\d+$/),
  eventType: z.string().max(100), ref: z.record(z.string().max(32), id) /* e.g. {caseId, appealId} */ });
export const trustSignal = notificationsDispatch;
export const maintenanceRun = z.object({ ...envelope, scheduledFor: isoTime });
```

`processingRev` is the `{rev}` in public keys (media-pipeline §5.2). It starts at 1 and grows only when an asset is
re-processed.

---

## 5. Sweepers (backstops) and schedules

All of them run on the `maintenance` queue as BullMQ job schedulers (`upsertJobScheduler`), registered when the
`core` deployment starts. Each has 1 attempt and alerts after 3 consecutive failures or missed runs.

| Scheduler | Every | Backstop for |
|---|---|---|
| `maintenance.moderation-sweep` | 5 min | Overdue `holdExpiresAt` (T7/R7), lapse (T10), AI pending guard (§4.1 fix), restricted items older than 48 h (alert), appeal SLA (A7), deferred strikes when the appeal window closes |
| `moderation.rescan-failed` | 10 min | Re-assessment of `AI_UNAVAILABLE` holds after recovery (pipeline §2.3) |
| `media.upload-sweep` (SEC-03) | `UPLOAD_SWEEP_INTERVAL_MS` (default 60 s) | `UPLOADING` slots older than the presign TTL (`MEDIA_PUT_TTL_SECONDS`, 10 min) can no longer receive a PUT: set `FAILED (UPLOAD_EXPIRED)` and delete any leftover ingest object. Status-guarded update (never races `confirm`), idempotent, batch of 500 per run. Expired slots still count toward the owner's rolling-24 h `MEDIA_DAILY_QUOTA`. Implemented as an interval in `apps/worker/src/main.ts` until the `maintenance` queue lands; the hourly `media-orphans` job below remains the 24 h backstop |
| `maintenance.media-orphans` | hourly | `UPLOADING` > 24 h → `FAILED (NOT_CONFIRMED)`; unattached `READY` > 24 h → purge. **Stuck processing:** `PROCESSING` asset whose expected job (deterministic id for its current step) is missing or failed → re-emit the step event once, then `FAILED (PROCESSING_ERROR)`; `PROCESSING` older than 7 h (past the scan budget) → `FAILED` |
| `maintenance.media-retention` | daily 03:00 UTC | Emits `media.purge_requested` per media-pipeline §6 |
| `maintenance.purge-media-logs` | daily | `MediaProcessingLog` 13 months, `ipHash` nulled at 90 days |
| `maintenance.clamav-freshness` | hourly | Alert when signatures are older than 24 h |
| `maintenance.outbox-purge` | daily | Published outbox rows older than 7 days (ADR-0007) |

---

## 6. Media failure handling (summary)

| Failure | Asset result | Objects | Parent effect | User | Log outcome |
|---|---|---|---|---|---|
| Invalid type, size, polyglot, codec, duration, pixels, corrupt | `REJECTED (<reason>)` | ingest and staging deleted | detached; text assessed alone | `MEDIA_REJECTED` | `REJECTED` |
| Banned hash | `REJECTED (BANNED_HASH)` | deleted; hash kept on the tombstone | detached; parent at least UNSURE (`MEDIA_MALWARE`-style rule) | `MEDIA_REJECTED` | `REJECTED` |
| Malware | `REJECTED (MALWARE)` | copied to `quarantine/` (30 d), ingest deleted | detached; RULE decision on parent → at least UNSURE; `TrustSignal MALWARE_UPLOAD` | `MEDIA_REJECTED` | `INFECTED` |
| Scanner down > budget | `FAILED (SCAN_UNAVAILABLE)` | ingest deleted, never decoded | detached; parent continues (its own media wait ends at 30 min → UNSURE if not yet decided) | `MEDIA_REJECTED` ("try again") | `ERROR` |
| Processing error after retries | `FAILED (PROCESSING_ERROR)` | staging deleted | detached | `MEDIA_REJECTED` ("try again") | `ERROR` |
| Promote fails | stays `READY` and private | — | content live without the media; alert | — | `ERROR` |
| Demote fails | stays public | origin delete retried first | **page**; content is already non-public in DB and the app stops rendering the URLs | — | `ERROR` |

Exact reason mapping (answers test-strategy §9.5): a polyglot is `TYPE_MISMATCH`; more than one video or audio
stream is `UNSUPPORTED_CODEC` (with `detail.subReason = "STREAM_LAYOUT"`); a video over 4096 px is
`TOO_MANY_PIXELS`. No new enum values are needed. The precise sub-reason goes in `MediaProcessingLog.detail`.

---

## 7. Observability per job

Every job emits `job_duration_seconds{job,outcome}` and `job_attempts_total{job,outcome}`. It also logs one
structured line per run, `{job, jobId, attempt, outcome, durationMs, traceId}`, with no payload values beyond ids.
Moderation-specific and media-specific alerts are in moderation-pipeline §11 and media-pipeline §7.

---

## 8. Scaffold deltas (M2 follow-ups, Backend Engineer)

The M1.5 scaffold predates this catalogue. Changes needed (none are made in this docs-only task):

| Where | Today | Target |
|---|---|---|
| `packages/core/src/queues.ts` `moderationJobSchema` | `{subjectType: REVIEW\|REPLY\|…, subjectId, version}` | `moderationAssess` (§4.4): adds `caseId`, `trigger`, envelope; `REPLY` → `SELLER_REPLY` (matches `ModerationCase.sellerReplyId`) |
| `packages/core/src/queues.ts` `mediaJobSchema` | one schema with `step: VALIDATE\|VIRUS_SCAN\|SANITISE\|VARIANTS` | one schema per job (§4.4). The `SANITISE` spelling disagreed with `MediaProcessingStep.SANITIZE`; the step now comes from the job name |
| `payloadSchemas` | keyed by queue | keyed by **job name** (several jobs share a queue) |
| `apps/worker/src/outbox.ts` `routes` | `Record<type, QueueName>`, job name = event type, job id `outbox__<id>` | `Record<type, Route[]>` with `{queue, job, key, delayUntil?}` (ADR-0013) |
| `apps/worker/src/processors.ts` | one processor per queue | dispatch by `job.name` within each queue processor |
| Worker settings | default back-off | named strategies (§3.2), `maxStalledCount: 1`, `lockDuration` per deployment |
