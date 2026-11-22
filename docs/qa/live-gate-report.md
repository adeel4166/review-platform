# LIVE-07 live gate report

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Task** | #95 on branch `task/95`, base `main` at `228c00e` |
| **Rule** | PASS only if zero open P0 and every P0 case is asserted by a named test with an **observed** result |

## Verdict: FAIL (gate not provable from this environment; no P0 defect found)

The live staging E2E and the role walkthrough **were not run**. This workspace has no Docker daemon (`docker: command not found`), no `gh`, no Playwright browser download, no running MySQL/Redis/MinIO, and no staging URL. Running a database server is outside this role's rules. Every row marked UNOBSERVED is unobserved, not passed. Nothing below was inferred from a green CI that I could not read.

## What was observed in this run

| Check | Result |
|---|---|
| `pnpm qa` (lint, typecheck, test, design:check) with a placeholder `DATABASE_URL` | **exit 0**. core 31 files / 607 tests; web 46 files / 873 passed + 1 todo; worker 33 files / 363 passed + 6 skipped |
| `pnpm qa` without `DATABASE_URL` | exit 1: `packages/db` `prisma validate` needs the variable (P1012). Environment, not a code defect; CI sets it |
| New walkthrough spec + staging config | typecheck and eslint clean. **Not executed** |
| SEC-FIN-01 (provider) | fixed in code since #89: `packages/core/src/moderation-provider.ts:134-136` builds the Anthropic provider and refuses a missing key. Live call to the real provider UNOBSERVED |
| SEC-FIN-02 (prod compose ledger/archive) | present: `docker-compose.prod.yml:73-95`. Compose render UNOBSERVED here (CI `prod-config`) |
| SEC-FIN-03 (ledger cap) | `packages/core/src/media.ts:151-153` now pages with `ContinuationToken` up to `limit`. Behaviour against a bucket with more than 10,000 objects UNOBSERVED |
| QA-M5-12 / MED-034 | `infra/cdn/media-headers.json` exists |

## M8 gate re-run: P0/P1 cases

CI results (`mysql-int`, `e2e`, `ops003`, `prod-config`, `staging-*`) must be pasted from Actions; I cannot read them. Until then the status is UNOBSERVED.

| ID | Pri | Named test | Result (this run) |
|---|---|---|---|
| OPS-001 | P0 | `apps/worker/src/maintenance/replay-deletions.int.test.ts:18,44` (mysql-int) | **UNOBSERVED** |
| OPS-002 | P0 | `apps/worker/src/security/totp-reencrypt.int.test.ts:24,35,45` (mysql-int) | **UNOBSERVED** |
| OPS-003 | P0 | `scripts/ops003-no-test-hooks.mjs` (CI `ops003`) | PASS at M8 (#88); not re-run |
| OPS-004 | P0 | `packages/core/src/env.test.ts` | PASS (inside `pnpm qa` this run) |
| **OPS-005** | P0 | external penetration test | **PENDING-CEO** (scope pack `docs/security/pentest-scope-pack.md`); not a code gap |
| OPS-006 | P1 | `packages/core/src/retention/rules.int.test.ts:13,28` (mysql-int) | UNOBSERVED |
| PRV-011 | P1 | `rules.int.test.ts:38` (mysql-int) | UNOBSERVED |
| PRV-012 | P1 | `apps/worker/src/account/erase.int.test.ts:36,60,67,77,84` (mysql-int) | UNOBSERVED |
| MED-030 | P0 | `apps/worker/src/moderation/assess.int.test.ts:39` (mysql-int) | UNOBSERVED |
| AIF-008 | P0 | `packages/core/src/moderation/assess.property.test.ts:21` | **PASS** (inside `pnpm qa`) |
| A11Y-004 | P0 | unit `apps/web/src/components/m6-ui.a11y.test.tsx:31` (PASS); e2e `apps/web/e2e/m6-queue-keyboard.spec.ts:5` | unit PASS; e2e UNOBSERVED |
| E2E-002 | P0 | `apps/web/e2e/m6-hold-appeal.spec.ts:10`; UI `m6-ui.a11y.test.tsx:71` | UI PASS; e2e UNOBSERVED |
| E2E-003 | P0 | `m6-hold-appeal.spec.ts:34`; UI `m6-ui.a11y.test.tsx:44` | UI PASS; e2e UNOBSERVED |
| E2E-004 | P0 | `m6-hold-appeal.spec.ts:46` | UNOBSERVED |
| E2E-005 | P0 | `m6-hold-appeal.spec.ts:78`; UI `m6-ui.a11y.test.tsx:71` | UI PASS; e2e UNOBSERVED |
| E2E-008 | P0 | `apps/web/e2e/m6-coi.spec.ts:6`; UI `m6-ui.a11y.test.tsx:59` | UI PASS; e2e UNOBSERVED |

## Role walkthrough coverage map (what a named test already asserts vs. gap)

Screenshots: none captured (see `live-walkthrough/README.md`). The new spec `apps/web/e2e/live-walkthrough.spec.ts` captures 7 roles x pages x desktop/mobile and asserts access refusal per role.

| Step | Named test | Status |
|---|---|---|
| register / verify email / login | `apps/web/e2e/auth.spec.ts` (E2E-AUTH-007..012) | UNOBSERVED live |
| 2FA setup and login | `apps/web/e2e/two-factor.spec.ts` | UNOBSERVED live |
| product page, write review, moderation | `review-flow.spec.ts`, `media-ui.spec.ts` | UNOBSERVED live |
| seller reply | `seller-reply.spec.ts`, `seller.spec.ts` | UNOBSERVED live |
| verified-buyer badge / proof | `verified-badge.spec.ts`, `/admin/proofs` | UNOBSERVED live |
| moderator decision, appeal, hold | `m6-*.spec.ts` | UNOBSERVED live |
| admin authz | `admin-authz.spec.ts` | UNOBSERVED live |
| ownership transfer (four-eyes) | `ownership-transfer.spec.ts` | UNOBSERVED live |
| search, compare | `apps/web/e2e/search-compare.spec.ts` (E2E-SRCH-1, E2E-CMP-1, E2E-CMP-2) | authored (#97); **UNOBSERVED** until CI `e2e` runs |
| helpful vote + own-review refusal | `apps/web/e2e/vote-report.spec.ts` (E2E-VOTE-1, E2E-VOTE-2) | authored (#97); **UNOBSERVED** |
| report -> moderation queue | `apps/web/e2e/vote-report.spec.ts` (E2E-RPT-1; staff enrols 2FA in-test) | authored (#97); **UNOBSERVED** |
| follow, notifications page | `apps/web/e2e/follow-notifications.spec.ts` (E2E-FOL-1, E2E-NOT-1) | authored (#97); **UNOBSERVED** |
| follow -> NEW_FOLLOWER notification | `follow-notifications.spec.ts` E2E-FOL-2 (now a normal test) | FIXED (DEF-LIVE-06/07, task #98); e2e not yet run in CI: UNOBSERVED |
| four-eyes role grant (`/admin/approvals`) | `apps/web/e2e/role-grant-erasure.spec.ts` (E2E-4EYE-1: self-approve refused, second SUPER_ADMIN approves; both enrol TOTP in-test) | authored (#97); **UNOBSERVED** |
| account erasure | API-driven `role-grant-erasure.spec.ts` E2E-ERASE-1; UI journey `E2E-ERASE-2` drives the UI | FIXED (DEF-LIVE-08, task #98); UNOBSERVED in CI |

## Defect log

| ID | Sev | Steps | file:line | Status |
|---|---|---|---|---|
| DEF-LIVE-01 | **P1 (gate blocker, environment)** | Run LIVE-07 on a host with Docker: none available to the agent; staging not reachable | `scripts/staging-up.sh:1`, `docs/qa/m8-02-staging-smoke-evidence.md` (all CI rows `pending`) | OPEN: needs a CEO-approved `DEPLOY_STAGING` and the first green CI run on `main` |
| DEF-LIVE-02 | P2 | Run `pnpm qa` with `DATABASE_URL` unset: `@rp/db test` fails P1012 | `packages/db/package.json` (`test: prisma validate`) | OPEN: use a placeholder URL locally; CI sets it |
| DEF-LIVE-03 | P2 | Search the e2e suite for vote, report, compare, follow, notifications, role grant, erasure UI: no specs | `apps/web/e2e/` (absent); related routes `apps/web/src/app/api/{follows,compare,reports}` | SPECS AUTHORED in #97 (typecheck + eslint clean); no CI run observed yet, so verification is UNOBSERVED. Remaining gaps: DEF-LIVE-06/07/08 |
| DEF-LIVE-06 | P2 | Follow a user; the followed user's `/account/notifications` stays empty. `NEW_FOLLOWER` exists in the schema and core types but nothing creates it | `apps/web/src/server/social.ts:55-75` (`putFollow` emits no notification/outbox event); consumer `apps/worker/src/notifications.ts:23-30` only resolves REVIEW recipients | FIXED (task #98): `apps/web/src/server/social.ts:69-74` emits `notification.requested` (NEW_FOLLOWER) in the follow transaction, new follows only; `apps/worker/src/notifications.ts:28-30` resolves USER recipients; preferences applied by `dispatch`. E2E-FOL-2 enabled |
| DEF-LIVE-07 | **P1** | Open `/account/notifications` once any notification or preference row exists: `t("notif.type.<TYPE>")` has no key in `en.ts`, so `en[key].replace` throws TypeError and the page crashes client-side (static analysis; not yet run) | `apps/web/src/components/m6/NotificationCenter.tsx:42,60,65`; `apps/web/src/i18n/en.ts` (zero `notif.type.*` keys); `en.ts:1075` | FIXED (task #98): 21 `notif.type.*` labels in `apps/web/src/i18n/en.ts`; `typeLabel` fallback at `apps/web/src/components/m6/NotificationCenter.tsx:12` (used at :44,:62,:67); E2E-NOT-1 asserts no page error |
| DEF-LIVE-08 | P2 | Look for account erasure in the UI: no page or component calls `DELETE /api/account` | `apps/web/src/app/api/account/route.ts:10` (API only); `apps/web/src/app/account/` | FIXED (task #98): `apps/web/src/components/account/AccountErasure.tsx:27` (danger zone, dialog, typed handle, step-up, sign-out + redirect) on `apps/web/src/app/account/delete/page.tsx`, linked from `/account/profile`; E2E-ERASE-2 enabled |
| DEF-LIVE-04 | P3 | Observed: 51 `unhandled route error` lines in `pnpm qa` output with a placeholder DB. Most likely tests that hit the DB layer with no DB; confirm they are intended error-path tests and silence expected logs | `apps/web/src/server/http.ts:43` | OPEN: triage |
| DEF-LIVE-05 | P2 | Staff accounts enrolled in 2FA land on `/login/2fa` after the credentials post; the walkthrough does not bypass 2FA, so staff pages may be refused until the demo accounts are provisioned without a 2FA gate | `apps/web/e2e/live-walkthrough.spec.ts` (`ctxFor`) | In #97 new staff specs enrol TOTP in-test via `social-helpers.ts` (`makeStaffWith2fa`); the older `m6-helpers.ts` `makeStaff` still creates staff without 2FA: verify on first CI run |

No P0 defect was found. No production source was modified.

## Acceptance check

| Criterion | Met |
|---|---|
| Zero open P0 | yes: none found, but the P0 cases below are unobserved |
| Every P0 case asserted by a named test with an observed result | **NO**: OPS-001, OPS-002, MED-030 and the e2e halves of E2E-002..005/008 and A11Y-004 are unobserved |
| OPS-005 listed as PENDING-CEO | yes |
| Every defect logged with id, severity, steps, file:line | yes |
| Screenshots per page (desktop + mobile) | **NO**: no stack |

## To turn this into PASS

1. CEO approves `DEPLOY_STAGING`; run `scripts/staging-up.sh` on a Docker host.
2. Open Actions > CI on `main`; paste run URLs and results for `mysql-int`, `e2e`, `ops003`, `prod-config`, `staging-stack` into `m8-02-staging-smoke-evidence.md` and the UNOBSERVED rows above.
3. Run the walkthrough command in `live-walkthrough/README.md`; commit screenshots and `walkthrough-results.json`.
4. Close DEF-LIVE-03 by adding the missing specs, then re-run this gate. OPS-005 remains PENDING-CEO regardless.
