# Media pipeline runtime (M5-01)

Implements m4-m5-spec §6–§11 for task #72. Code: `apps/worker/src/media.ts`, `media/{clamd,validate,verify,video,publish,health}.ts`.

## Flow (one `media.uploaded` job, one read of the ingest object)
size/exists → content type → polyglot (images) → banned hash → ClamAV (`zINSTREAM`) → re-encode (sharp / ffmpeg) → verify no metadata (exiftool) → `READY` in `rp-private`.
Infected → `FAILED/MALWARE`, bytes moved to `rp-private/quarantine/<id>`, alert, threat name only in `media_processing_logs`.

## Publication (MED-037)
Only `media.promote` (event `media.promote_requested`, emitted by `transitionCase` on approval, plus the 60 s `reconcilePublication` sweep) copies to `rp-public/m/<id>/…`. It re-reads review status, published version, asset visibility and the APPROVED case. DB CHECK `chk_media_public_bucket` rejects any row with `bucket = PUBLIC` lacking scan, strip and moderation clearance. `media.demote` / the sweep move it back and purge the CDN.

## ClamAV freshness (INF-003)
`zVERSION` on each scan and every 10 min. >24 h: `CLAMAV_STALE` alert (≤1 per 6 h), `/healthz` 503, scans continue. >72 h: scan treated as unavailable (retry, fail closed). `/healthz` on `WORKER_HEALTH_PORT`.

## Deviations from the spec (follow-ups)
- Single job instead of `media.scan` -> `media.image`. The staged original is read once; a job-recorded sha256 (`mediaJobSchema.sha256`) or a previously stored `MediaAsset.sha256` is compared and a mismatch is `FAILED (PROCESSING_ERROR)` + `STAGING_HASH_MISMATCH` (MED-043).
- Parser sandbox (task #84): ffmpeg, ffprobe, pdfinfo and pdftoppm run through `apps/worker/src/media/sandbox.ts` (bwrap `--unshare-all` + prlimit, `-protocol_whitelist file`, forced `mov` demuxer). Startup self-test (`assertMediaSandbox`) exits 1 when `MEDIA_SANDBOX_REQUIRED=true` (default in production/CI) and bwrap is missing, the network is reachable or `/usr` is writable. The worker image must ship bwrap, prlimit, poppler-utils and the seccomp profile. **sharp/libvips still decodes in-process** (the separate decode child of spec 8.4 is a follow-up); it runs under the 50 MP limit.
- Legal hold on a hash-list match: the original is copied to `rp-private/legal-hold/{assetId}` (never swept). A `legalHold` column on `MediaAsset` and a stored pHash need a DB_MIGRATION proposal (follow-up). `HashMatcher` (`media/hash-match.ts`) is the L-17 plug-in point; the stub matches `BannedMediaHash`.
- `media` worker group (`WORKER_GROUPS=media`, INF-008) runs only the media queue and refuses to start with `MODERATION_API_KEY`/`ANTHROPIC_`/`OPENAI_`/`AI_`/`SMTP_` variables or auth/2FA secrets.
- Quarantine retention: `sweepQuarantine` (daily) purges `quarantine/` after 30 days and alerts `QUARANTINE_COUNT_HIGH` above 50 objects (SEC-M5-03).
- HEIC, `media.purge`, minio-init user creation, CDN purger API client: not done.
- `scripts/inf002-bucket-check.sh` and `infra/minio/policies/*.json` are provided but `minio-init` does not create the users yet.
