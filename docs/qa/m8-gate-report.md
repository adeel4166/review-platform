# M8 QA gate report

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Task** | #88 FINAL GATE, branch `task/88`, main at `2a9319d` |
| **Scope** | [test-strategy.md](./test-strategy.md) §6 M8: `OPS-001..004`, `OPS-006`, `PRV-011/012`. `OPS-005` is **PENDING-CEO** (external pen test; scope pack `docs/security/pentest-scope-pack.md`), not a code gap |
| **Rule** | PASS = zero open P0 and all P0 cases asserted by named tests |

## Verdict: FAIL (not provable PASS)

No P0 defect was found in code, but two M8 P0 cases (OPS-001, OPS-002) are asserted **only** by MySQL integration suites that this sandbox cannot run (no MySQL service, no docker, no `gh` to read the CI job). I will not record an unobserved result as PASS. Three P1 findings (SEC-FIN-01..03) mean retention, erasure and AI moderation cannot work in the production compose.

## Evidence

| Check | Result |
|---|---|
| `pnpm qa` (lint, typecheck, test, design:check), `DATABASE_URL` placeholder | exit 0; core 594, web 854 + 1 todo, worker 326 + 6 skipped |
| `pnpm --filter @rp/web build` then `node scripts/ops003-no-test-hooks.mjs apps/web/.next` | ok, 635 files, no sentinel |
| `it.fails` / `test.fails` anywhere | none |
| CI `mysql-int` (`.github/workflows/ci.yml:160-197`) | defined; **result not available to this run** |

## Cases

| ID | Pri | Result | Named test |
|---|---|---|---|
| OPS-001 | P0 | **UNVERIFIED (int, CI)** | `apps/worker/src/maintenance/replay-deletions.int.test.ts:17` |
| OPS-002 | P0 | **UNVERIFIED (int, CI)** | `apps/worker/src/security/totp-reencrypt.int.test.ts:23` |
| OPS-003 | P0 | **PASS** (run here) | `scripts/ops003-no-test-hooks.mjs`, CI `ops003` self-check |
| OPS-004 | P0 | **PASS** | `packages/core/src/env.test.ts:7,23` |
| OPS-005 | P0 | **PENDING-CEO** | external pen test, not a code gap |
| OPS-006 | P1 | UNVERIFIED (int, CI) | `packages/core/src/retention/rules.int.test.ts:11` |
| PRV-011 | P1 | UNVERIFIED (int, CI) | `rules.int.test.ts:37` |
| PRV-012 | P1 | UNVERIFIED (int, CI) | `apps/worker/src/account/erase.int.test.ts:35` |

## Open findings (from `docs/security/final-security-review.md`, confirmed in code)

| ID | Sev | file:line |
|---|---|---|
| SEC-FIN-01 no production moderation provider; every non-mock name throws | P1 | `packages/core/src/moderation-provider.ts:65-71` |
| SEC-FIN-02 prod compose lacks ledger, audit archive, `ARCHIVE_DATABASE_URL` | P1 | `docker-compose.prod.yml:80`, `apps/worker/src/m8-jobs.ts:20-22` |
| SEC-FIN-03 ledger reader caps at 10,000 objects oldest-first | P1 | `packages/core/src/retention/ledger.ts:29`, `packages/core/src/media.ts:147-156` |

## Final fix task (exact list)

1. QA-M5-12 / MED-034: add `infra/cdn/media-headers.json` (nosniff, `CSP: sandbox`) and a test that reads it; `apps/worker/src/media/publish.ts:51`.
2. QA-M5-12 / MED-028: test that promote copies the derivative with equal sha256 and that an ingest key cannot be overwritten after confirm; `apps/worker/src/media-publish.test.ts:42`.
3. SEC-FIN-01/02/03 at the locations above (SEC-FIN-01 is launch-blocking per the security review).
4. Re-run with the `mysql-int` and `e2e` CI results attached (OPS-001/002/006, PRV-011/012, MED-030, AIF-008, E2E-002..005/008, A11Y-004).
