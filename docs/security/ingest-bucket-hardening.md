# Ingest bucket hardening (T-08 / SEC-07(3), QA-M3B-02)

`rp-ingest` holds unverified uploads written by browsers through presigned PUT URLs. Two controls apply.

## 1. 24 h expiry
Objects in `rp-ingest` expire after 1 day. The worker moves verified media to `rp-private`/`rp-public`, so anything left is abandoned or rejected.

- **Local MinIO:** `minio-init` in `docker-compose.yml` runs `mc ilm rule add --expire-days 1 local/rp-ingest`, skipped if a rule already exists (idempotent on re-run).
- **Cloudflare R2:** Bucket → Settings → Object lifecycle rules → add rule "expire-ingest": prefix empty (whole bucket), action *Delete uploaded objects* after **1 day**. Also add *Abort multipart uploads* after 1 day.

## 2. CORS: app origin only, PUT only
- **Local MinIO:** OSS MinIO has no per-bucket CORS API. `MINIO_API_CORS_ALLOW_ORIGIN` on the `minio` service is set from `APP_URL` (default `http://localhost:3000`). It is server-wide, never `*`.
- **Cloudflare R2:** Bucket `rp-ingest` → Settings → CORS policy:

```json
[{
  "AllowedOrigins": ["https://<production app origin>"],
  "AllowedMethods": ["PUT"],
  "AllowedHeaders": ["content-type", "content-length"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 600
}]
```
No wildcard origin. Do not add GET/POST/DELETE. Do not apply CORS to `rp-private`.

## Verification
`scripts/t08-minio-check.sh` checks the local stack (content-length signing, PUT after confirm, CORS preflight, `mc ilm rule ls`). Repeat the lifecycle and CORS checks by hand against R2 before launch.
