# ADR-0006: Media storage layout and processing pipeline

| | |
|---|---|
| **Status** | Accepted (merged to `main` with CEO approval, proposal #9) |
| **Date** | 2026-11-20 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #19 (M1.2) |
| **Related** | [media-pipeline.md](../architecture/media-pipeline.md), ADR-0001 §1 and §5 (**amended**), ADR-0005, data-model.md §6.2 / §7 |

## Context

Users upload photos (≤ 10 MB) and short videos (≤ 30 s, ≤ 50 MB, MP4/MOV) to reviews and posts. The brief requires
direct browser upload to object storage, virus scanning, EXIF/GPS stripping, transcoding videos to 720p, and
scan/upload logs. ADR-0001 chose R2 with two buckets (public, private) and let browsers PUT **directly into the public
bucket**. That would expose unscanned files and original EXIF/GPS metadata at a public URL before processing, and the
web app's presign credential would need write access to public storage.

## Decision

1. **Three buckets per environment:** `ingest` (private, raw untrusted uploads, 2-day lifecycle backstop), `private`
   (processed media that is not public, evidence, quarantine) and `public` (published media behind the CDN only).
   This **amends ADR-0001**: browsers upload only to `ingest`.
2. **Presigned PUT** with signed `Content-Type` and `Content-Length` (10 min, one object, server-generated key), then a
   mandatory `confirmUpload` that checks the object with `HEAD` and writes the outbox event.
3. **Worker pipeline, fail closed:** byte-capped fetch → magic-byte validation → **ClamAV** scan (limits raised to
   64 MB) → photos: libvips decode with pixel limit, auto-orient, **re-encode without any metadata** and verify →
   WebP variants; videos: ffprobe validation → ffmpeg transcode to **H.264/AAC MP4 ≤ 720p**, `-map_metadata -1`,
   faststart, sandboxed. Scanner unavailable → retry for ~6 h, then `FAILED`. Nothing is decoded before the scan passes.
4. **Visibility follows moderation:** processed media stays in `private` until its parent is `PUBLISHED`
   (`media.promote`), and is moved back with a CDN purge when the parent is hidden, removed or deleted
   (`media.demote`, paging on failure). Public keys are immutable (`m/{assetId}/{variant}.{rev}.{ext}`).
5. **Least-privilege credentials:** the web app can presign PUT to `ingest` and GET from `private`; only the worker
   writes to `public`.
6. **Append-only `MediaProcessingLog`** records every step (slot issued, confirmed, validated, scanned with engine and
   signature version, sanitised, transcoded, promoted, purged), without file names or metadata values.
7. **Retention** is driven by parent state (published → lifetime; rejected/removed → appeal window + 60 days;
   deleted → 90 days; orphans → 24 h; quarantine → 30 days), blocked by `legalHold`, all OPEN(LEGAL).

## Alternatives considered

| Option | Why not |
|---|---|
| Upload directly to the public bucket (ADR-0001 §5 as written) | Unscanned files and GPS metadata publicly reachable until processing finishes; web credential needs public write |
| Prefixes in one private bucket instead of a separate ingest bucket | Works for lifecycle rules, but cannot scope the web app's write credential away from processed and evidence objects |
| Proxy uploads through the Next.js server | Ties up app servers with 50 MB bodies; serverless body limits; the brief asks for direct upload |
| Presigned POST with `content-length-range` | Not supported by R2; signed `Content-Length` on PUT gives the same guarantee |
| Serve all media privately via signed URLs | No CDN caching for the main read path; URL churn breaks caching and sharing |
| Managed video service (Cloudflare Stream, Mux) | Strong option, but adds a vendor and per-minute cost before volumes are known; the `media.transcode` job hides the choice and can be swapped later |
| Strip EXIF with exiftool in place instead of re-encoding | Leaves unknown container blocks; re-encoding from pixels is the only robust strip and also neutralises many malformed-file exploits |
| Commercial malware scanning API | Sends user files to another processor (L-6); ClamAV in-cluster is sufficient as defence in depth since media is always re-encoded |

## Consequences

**Positive**

- No raw upload is ever publicly reachable; metadata stripping is verified, not assumed.
- Removing content also removes its media from public storage and the CDN.
- Each pipeline step is auditable per asset (needed for incident response and transparency reports).

**Negative / risks**

- One more bucket and the promote/demote copy step (extra storage operations, eventual consistency between DB and CDN).
- Self-run ClamAV and ffmpeg need image maintenance (signature freshness alert, CVE patching).
- HEIC support depends on libvips being built with libheif in the worker image.

## Follow-ups

- Scaffold task: create the three buckets per environment, lifecycle rules, CORS, scoped API tokens, worker image with
  libvips+libheif, ffmpeg and a clamd sidecar; MinIO in CI.
- Threat-model task: review §9 of media-pipeline.md (sandboxing, cookieless media domain, banned-hash matching).
- Update data-model.md §4 `storageKey` format (done in this change) and ADR-0001 index note.
