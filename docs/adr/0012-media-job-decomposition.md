# ADR-0012: Media processing as step jobs with a verified staging copy (amends ADR-0006)

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #25 (M1-T2) |
| **Related** | ADR-0006 (pipeline, amended here), ADR-0007 (outbox), [job-catalogue.md](../architecture/job-catalogue.md) §4.2, [media-pipeline.md](../architecture/media-pipeline.md), threat-model U-4/U-5 (gap G-7) |

## Context

ADR-0006 describes one `media.process` job that validates, scans, sanitises and builds variants. Videos hand off to
`media.transcode`. Three problems:

1. **One retry budget for different failures.** The 6-hour schedule exists for scanner outages. It also re-runs a
   deterministic libvips or ffmpeg failure, and it re-scans from scratch after a crash in the variant step.
2. **TOCTOU (threat U-5).** The presigned PUT stays valid for 10 minutes. The design read the ingest object more
   than once: in the scan step, and again before decoding and transcoding. An attacker could overwrite the object in
   between, so the bytes that were decoded would not be the bytes that were scanned.
3. **Confirm ownership (U-4).** The design did not say who may confirm a slot.

## Decision

1. **Three step jobs**, chained through the outbox (not a direct enqueue), so that each step's completion and the
   next request commit together:
   `media.scan` (VALIDATE, banned hash, VIRUS_SCAN; `media` queue) → `media.image` (SANITIZE, resize, thumbnails,
   perceptual hash; `media`) **or** `media.transcode` (probe, 720p, verify, poster and thumbnails, frames;
   `media-video`). Each job has its own retry budget: `scanner` 9 attempts ≈ 6 h; image 3 attempts; transcode 3
   attempts. Deterministic failures are `UnrecoverableError`.
2. **Verified staging copy.** `media.scan` reads the ingest object **once** into a byte-capped temp file and computes
   its sha256. It scans **that file** and uploads **that file** to `rp-{env}-private/staging/{assetId}/original`
   with a checksum. Then it deletes the ingest object and records `sha256`, `bucket = PRIVATE` and the staging
   `storageKey`. Later steps read only from staging and refuse to decode unless the bytes match the sha256 in their
   payload. A later PUT to the ingest key is never read. Staging is deleted when processing finishes and has a 2-day
   lifecycle rule.
3. **Confirm guard.** `confirmUpload` is a conditional update `UPLOADING → PROCESSING` where `ownerId = caller` and
   the slot has not expired, after `HEAD` matches the declared size and type. It is one-shot, and a repeated confirm
   returns the current status. Where the provider supports conditional writes, the slot also signs
   `If-None-Match: *`. To verify in the M5 spike against R2 and MinIO; the design does not depend on it.
4. **Resizing and thumbnails stay in one job.** A single decode produces all variants. A separate thumbnail job would
   decode untrusted input twice.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep one `media.process` job | Mixed retry budget, re-scan on any crash, TOCTOU remains |
| Chain steps with direct `queue.add` from the processor | Allowed by ADR-0007, but a crash between the DB commit and the add loses the next step. Then only a sweeper recovers it, after up to an hour |
| BullMQ flows (parent/child jobs) | Expresses dependencies but not "next step chosen by detected kind". It also adds Redis-only state that ADR-0007 says must be rebuildable |
| Server-side copy ingest → private (no worker upload) | The copy would not be tied to the bytes that were scanned. It is cheaper, but it re-opens the TOCTOU |
| Separate thumbnail job | Second decode of untrusted bytes, an extra hop, no reliability gain |

## Consequences

**Positive:** decoders never see bytes the scanner did not see. Each step retries for the right reason. A crash in
variants does not re-scan. The ingest object lives for minutes instead of the whole pipeline.

**Negative:** two extra outbox hops (about 1 s of latency each in production). One more object write per upload
(staging). A new `staging/` prefix in the private bucket, with a 2-day lifecycle rule.

## Follow-ups

- M5 (Backend/DevOps): add the `staging/` lifecycle rule. Verify `If-None-Match` presign support. Implement the jobs
  per job-catalogue.md §4.2. Add test `MED-028` (overwrite after confirm is never processed).
