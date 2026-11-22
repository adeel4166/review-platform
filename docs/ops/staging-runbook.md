# Staging runbook (LIVE-05)

One Docker host, one public URL. Stack: MySQL, Redis (ACL), MinIO (+ `minio-init`: `rp-ingest/private/public`, object-locked `rp-ledger` and `rp-audit-archive`, least-privilege users), ClamAV, `migrate` (one-shot), `web` (`next start`), `worker-core`, `worker-media`, `verification-egress`, Mailpit (mail sink). Defined in `docker-compose.staging.yml`; driven by `scripts/staging-up.sh`.

This runbook does not deploy anything by itself. Putting this stack on a **real shared host** is a deployment: raise a `DEPLOY_STAGING` proposal and wait for CEO approval first.

## Prerequisites
- Docker Engine with Compose v2, `openssl`, `curl`; ~4 GB RAM free (ClamAV ~1.5 GB, first start downloads signatures, allow several minutes).
- Unprivileged user namespaces allowed for `worker-media` (bubblewrap sandbox; it fails closed with exit 1 otherwise).
- A real moderation provider key from the secret store. **`mock` and unset are refused** (script preflight, compose `:?`, and worker startup).
- Free ports `WEB_PORT` (3000, the one app URL) and `MINIO_PORT` (9000, browsers load media and PUT presigned uploads there). Mailpit UI is loopback-only (`MAILPIT_UI_PORT`, 8025).

## Start
```bash
git clone <repo> && cd review-platform           # clean checkout
export MODERATION_PROVIDER=anthropic
export MODERATION_API_KEY=...                    # from the secret store; never written to disk by the script
scripts/staging-up.sh
```
What it does: preflight (names only, fails closed) -> generates missing secrets into `.env.staging` (mode 600, gitignored; only variable *names* are printed) -> `docker compose up -d --build` -> `migrate` runs `prisma migrate deploy` and `pnpm db:seed:demo` -> waits for `/api/health` -> runs `scripts/staging-smoke.mjs` (home, product page, login page, static assets, admin login + admin API, a review submission that reaches the moderation queue). Output is also saved to `.staging-smoke.txt`.

Set `STAGING_HOST` to a name/IP resolvable from both browsers and the `web` container (default: the host's primary IP). It is baked into `APP_URL` (also MinIO CORS) and `S3_PUBLIC_ENDPOINT` (presigned URLs), so changing it later means editing those names in `.env.staging` and re-running `up`.

Demo logins: `demo.user@`, `demo.seller@`, `demo.moderator@`, `demo.senior-moderator@`, `demo.admin@`, `demo.super-admin@` `demo.example`; shared password = `DEMO_PASSWORD` in `.env.staging` (read it there; the script never prints it). Verification mails land in Mailpit (`ssh -L 8025:127.0.0.1:8025 <host>`).

## Stop / status / logs
```bash
scripts/staging-up.sh status            # container states + health
scripts/staging-up.sh logs web          # follow one service (omit for all); also worker-core, worker-media, migrate, minio-init
scripts/staging-up.sh stop              # stop containers, keep everything
scripts/staging-up.sh down              # remove containers/network, KEEP volumes (data survives the next `up`)
docker compose -p rp-staging -f docker-compose.staging.yml --env-file .env.staging down -v   # DESTRUCTIVE: also deletes MySQL, Redis, MinIO (incl. locked ledger) data
```

## Reseed
`scripts/staging-up.sh reseed` re-runs `migrate deploy` and the idempotent demo seed (deterministic ids, upserts; refreshes demo passwords from `DEMO_PASSWORD` and cached aggregates). The seed refuses `NODE_ENV`/`APP_ENV=production`. To start from an empty database: `down -v` (above), then `up`. Set `STAGING_SEED_DEMO=0` in `.env.staging` to migrate without demo data.

## Smoke on demand
`scripts/staging-up.sh smoke` (runs inside the web container against `127.0.0.1:3000`). Expect one `SMOKE OK ...` line per check and a final `SMOKE PASSED`. Review submissions create real demo rows (title `Staging smoke <hex>`); they are harmless and visible in the admin queue.

## Rollback
- Code: `git checkout <previous-good-sha> && scripts/staging-up.sh` (rebuilds images; tag older images with `RP_IMAGE_TAG=<sha>` to keep them).
- Schema: migrations are forward-only. Roll back by restoring a database backup (`docs/ops/restore-runbook.md`), not by down-migrating. Take a dump before upgrading: `docker compose -p rp-staging -f docker-compose.staging.yml --env-file .env.staging exec mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" review_platform' > backup.sql`.
- Bad config/secret: fix `.env.staging`, re-run `scripts/staging-up.sh` (existing values are never overwritten).
- Worker exits at startup (`worker.startup.refused`): the fail-closed checks fired (provider unset/mock, missing sandbox). Read `logs worker-core` / `logs worker-media`; names only, no values.

## Egress policy
`verification-egress` fetches attacker-controlled URLs. Apply `infra/egress/egress-policy.sh` (`EGRESS_SUBNET=172.28.0.0/24 APPLY=1`, root) on the host to enforce the RFC1918/metadata deny-list; compose only provides the isolated network.

## CI
Jobs `mysql-int`, `ops003`, `prod-config`, `staging-smoke`, `e2e`, plus `staging-config` (renders this compose, static checks, preflight refusal) and `staging-stack` (runs `staging-up.sh` end to end, artifact `staging-stack`). Evidence: `docs/qa/m8-02-staging-smoke-evidence.md`.

## No-domain VPS deploy (LIVE-08)
Single 4 GB Ubuntu VPS, IP only: follow [vps-quickstart.md](vps-quickstart.md). `scripts/staging-up.sh` now runs `scripts/vps-preflight.sh` first (Docker + Compose v2, >= 4 GB RAM, free ports, user namespaces, public `STAGING_HOST`) and refuses to start otherwise. Optional HTTPS: `STAGING_TLS=1` (Caddy profile `tls`).
