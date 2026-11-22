# M8-02 / LIVE-05 staging smoke evidence

Status: **CI evidence PENDING.** The agent workspace has no Docker daemon, no MySQL, no `gh` CLI and no push rights, so no CI run URL and no smoke line could be observed or recorded by task #93. Nothing below is claimed green that was not observed. Fill the table after the first CI run on `main` that contains this change (`Actions > CI > <run>`).

## CI jobs required green on `main` (LIVE-05 acceptance)
| Job | What it proves | Run URL | Result |
|---|---|---|---|
| `mysql-int` | `*.int.test.ts` + real-MySQL schema suites on migrated MySQL 8 | _paste_ | _pending_ |
| `ops003` | no test-only hooks in the production web build | _paste_ | _pending_ |
| `prod-config` | prod compose renders, hardening checks, worker image sandbox, fail-closed startup | _paste_ | _pending_ |
| `staging-smoke` | `preview-up.sh` production `next start` + static-asset smoke (artifact `staging-smoke`) | _paste_ | _pending_ |
| `e2e` | Playwright review flow on seeded MySQL + Redis + MinIO | _paste_ | _pending_ |
| `staging-config` (new) | `docker-compose.staging.yml` renders, `scripts/staging-config-check.sh`, preflight refuses mock/unset | _paste_ | _pending_ |
| `staging-stack` (new, non-gating until green once) | `scripts/staging-up.sh` end to end incl. login + review -> moderation queue (artifact `staging-stack`) | _paste_ | _pending_ |

## Smoke-evidence lines to paste (from artifacts `staging-smoke` and `staging-stack/staging-smoke-evidence.txt`)
```
SMOKE OK: 3 pages, N static assets all HTTP 200 (http://127.0.0.1:5101)          <- staging-smoke job
SMOKE OK home (HTTP 200)                                                         <- staging-stack job, expected shape
SMOKE OK product-page (/products/<slug> HTTP 200)
SMOKE OK login-page (HTTP 200)
SMOKE OK static-assets (...)
SMOKE OK admin-login (role ADMIN, moderation API HTTP 200)
SMOKE OK review-to-moderation-queue (review <id> on /products/<slug> -> moderation case state <STATE>)
SMOKE PASSED: home, product page, login, admin login, review -> moderation queue (<url>)
```

## Observed locally by task #93 (no Docker)
- `pnpm lint`: clean. `bash scripts/staging-config-check.sh`: all checks ok. `docker-compose.staging.yml` and `ci.yml` parse as YAML.
- `scripts/staging-up.sh up` preflight, run with a scrubbed environment: refuses unset provider, `mock`, an unsupported provider and a missing `MODERATION_API_KEY`, each exit 1, before any docker call.
- With stubbed `docker`/`curl`: secret generation writes an env file with mode 600, prints variable NAMES only, never writes `MODERATION_API_KEY`.
- `node scripts/staging-smoke.mjs` argument/env handling verified (fails loudly without `DEMO_PASSWORD` or an unreachable URL). The full smoke has not run against a live stack here.

## Host deploy
Not performed. A real staging host deploy requires an approved `DEPLOY_STAGING` proposal (see `docs/ops/staging-runbook.md`). No proposal tool was available in this run, so the DEPLOY_STAGING proposal still has to be raised (see RISKS in the task report).
