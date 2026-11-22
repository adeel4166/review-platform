# M8-02: CI MySQL job, ops003, production config and launch readiness

Task #86. Secrets are referred to by variable NAME only; no `.env` was read.

## CI (`.github/workflows/ci.yml`)
| Job | What it proves |
|---|---|
| `mysql-int` (QA-M6-04) | MySQL 8 service, `prisma migrate deploy`, then every `*.int.test.ts` suite (retention rules, sweep/TMR-014, assess MOD-020/021, burst, erasure, replay-deletions, audit-export, totp-reencrypt, `m6.int.test.ts`) and `apps/worker/src/mysql-schema.int.test.ts` (enabled by `RP_INT_MYSQL=1`): checks in real MySQL the `chk_media_public_bucket` CHECK, `moderation_cases.openKey` unique (MOD-020/021), `reports(reporterId, reviewId)` unique (RPT-004), `review_votes` PK (VOT-003), DATETIME(3) timers and UTC clock (TMR-014), `users.status`. |
| `ops003` | `next build`, then `scripts/ops003-no-test-hooks.mjs apps/web/.next`, plus a self-check that a planted hook fails the scan. The worker has no `dist/` (it runs from source through tsx), so only the web output is scanned. |
| `prod-config` | Renders `docker-compose.prod.yml`, runs `scripts/prod-config-check.sh`, builds `infra/docker/worker.Dockerfile`, asserts `bwrap prlimit pdftoppm exiftool ffmpeg` exist in the image, and that the image exits 1 with `MODERATION_PROVIDER` unset. |
| `staging-smoke` | `scripts/preview-up.sh` with `PREVIEW_USE_CWD=1` (production `next start` of the commit, then `preview-smoke.mjs`); output uploaded as the `staging-smoke` artifact. No deploy. |

## Production config
- `docker-compose.prod.yml` + `.env.production.example` (names only): Redis with an ACL rendered at start from env (`default` password-protected, `verif-egress` limited to its two queues), `noeviction`; MinIO with CORS pinned to `APP_URL`, 24 h ingest lifecycle, `rp-public` the only anonymous-read bucket, and per-role users bound to `infra/minio/policies/rp-{core,media,web}.json` (`minio-init`, profile `init`); ClamAV with `infra/clamav/clamd.conf`; `worker-core`, `worker-media`, `verification-egress` from one image; fixed egress subnet `172.28.0.0/24`.
- Egress policy: apply `infra/egress/egress-policy.sh` on the host (`EGRESS_SUBNET=172.28.0.0/24 REDIS_IP=<redis ip on that network> DNS_SERVERS=... APPLY=1`, as root). Not applied by compose; part of the deploy checklist.
- `infra/docker/worker.Dockerfile`: bubblewrap, util-linux (prlimit), poppler-utils, ffmpeg, exiftool; non-root; `MEDIA_SANDBOX_REQUIRED=true`.
- Fixed `docker-compose.yml` (dev): `clamav` and the `egress` network were mis-nested (the `clamav` service sat under `networks:`), so the ClamAV service was never defined.

## Fail-closed startup
- `assertModerationProviderConfigured` (`packages/core/src/moderation-provider.ts`) runs at `core-main.ts` boot: production with `MODERATION_PROVIDER` unset/`mock`/unsupported logs `worker.startup.refused` and exits 1 (previously it failed only at the first moderation job). Test: `apps/worker/src/m8-02-startup.test.ts`.
- Media sandbox: existing `assertMediaSandbox` (MED-047) already exits 1 when `MEDIA_SANDBOX_REQUIRED` (default in production/CI) and bwrap is missing, the network is reachable or `/usr` is writable.
- `scripts/preview-up.sh` refuses `NODE_ENV=production` with a mock/unset provider.
- Build fix: `apps/web/src/instrumentation.ts` made the edge compile fail with `UnhandledSchemeError: node:*` (barrel import of `@rp/core` outside the `NEXT_RUNTIME === "nodejs"` branch). The node-only import moved to `instrumentation-node.ts` inside the guarded branch.

## Evidence
See `docs/qa/m8-02-staging-smoke-evidence.md`.
