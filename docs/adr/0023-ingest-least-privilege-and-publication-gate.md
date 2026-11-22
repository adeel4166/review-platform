# ADR-0023: Confirm without `HEAD`, and a database-enforced publication gate (amends ADR-0006 / ADR-0012)

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #67 (M4-01) |
| **Related** | [ADR-0006](./0006-media-storage-and-processing.md) §2, §5, [ADR-0012](./0012-media-job-decomposition.md) §3, [m4-m5-spec.md §6.4, §10.1, §11](../architecture/m4-m5-spec.md#64-confirm-without-head-adr-0023-inf-002), catalogue INF-002, MED-027, MED-037 |

## Context

1. **INF-002** requires that the web credential has no GET on the ingest bucket. But ADR-0006 §2 and ADR-0012 §3
   have the web app `HEAD` the object at confirm, and an S3 `HEAD` needs `s3:GetObject`. The MVP code does that
   `HEAD` today (`apps/web/src/server/media.ts`).
2. **MED-037** requires "no public object before scan **and** moderation", with a DB CHECK. The draft
   `chk_media_public_bucket` only checks `visibility = PUBLIC`. It cannot see the scan or the moderation outcome.

## Decision

1. **Confirm does not touch storage.** It is a conditional `UPLOADING → PROCESSING` update (owner, unexpired slot)
   plus the outbox event. Because `content-type` and `content-length` are signed into the PUT, storage already
   refuses wrong types and sizes. Existence and the exact size are checked by `media.scan`, which reads the object
   once anyway: missing → `REJECTED (NOT_CONFIRMED)`, wrong size → `TYPE_MISMATCH` / `TOO_LARGE`.
2. **Web credential on ingest = `PutObject` on `in/*` only** (MinIO policy, S3 IAM). On R2, if a token cannot be
   write-only, the residual is accepted and covered by a static check that the web app never reads ingest
   (INF-006), and by ingest objects living only minutes (deleted by `media.scan`) plus the 1-day lifecycle.
3. **Publication gate in the DB.** New column `MediaAsset.moderationClearedAt`, set only by `media.promote` after it
   has re-read the approving decision, and cleared by `media.demote`. The CHECK becomes:
   `bucket <> 'PUBLIC' OR (visibility = 'PUBLIC' AND status = 'READY' AND virusScannedAt IS NOT NULL AND
   metadataStripped = 1 AND moderationClearedAt IS NOT NULL AND promotedAt IS NOT NULL)`.
   A code path that marks an asset public without the scan, the strip check and the moderation step fails at the
   database, not only in review.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep `HEAD` in confirm and grant web GET on ingest | Breaks INF-002. A leaked web credential could read every raw, unmoderated upload, including evidence |
| `ListObjectsV2` with the key as prefix instead of `HEAD` | Avoids GetObject on S3, but on R2 list and get share one permission. Adds a call for a check the worker does anyway |
| Move confirm into the worker entirely (browser calls nothing) | Needs storage event notifications, which MinIO and R2 handle differently. Confirm also carries the ownership check (U-4) |
| Store a `moderationDecisionId` FK instead of a timestamp | A FK to a moderation row would tie `media_assets` CHECKs to ON DELETE rules (ER 3823) and to the M6 decision table that does not exist yet. A timestamp written by one job is enough for the CHECK |

## Consequences

**Positive:** the web credential cannot read raw uploads (on S3/MinIO). The "never public before scan and moderation"
rule holds even with a bug in application code.

**Negative:** upload failures that `HEAD` caught at once (no PUT made, size mismatch) now surface asynchronously,
seconds later, through the asset status. The UI polls the media list. MED-027 needs a wording update (the rejection
happens in `media.scan`).

## Follow-ups

- M5-01: drop `HEAD` from `confirmUpload`, add the MinIO users and policies, `scripts/inf002-bucket-check.sh`, the
  CHECK and the column. Spike: R2 token granularity and `If-None-Match` on presigned PUT.
- QA: update MED-027 wording and add INF-006 (m4-m5-spec §13.7).
