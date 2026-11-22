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
- Single job instead of `media.scan` → `media.image`: no staging copy / sha256 re-check is needed because nothing is read twice.
- Parser sandbox (bwrap + prlimit, §8.4) is not wired; ffmpeg/ffprobe run with a kill timeout in a private temp dir. Must be added in the worker image before production.
- PDF evidence, HEIC, `media.purge`, retention sweeps, MED-030 moderation wait, minio-init user creation, CDN purger API client: not in this task.
- `scripts/inf002-bucket-check.sh` and `infra/minio/policies/*.json` are provided but `minio-init` does not create the users yet.
