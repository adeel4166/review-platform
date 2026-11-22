# M6 QA gate report

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Task** | #82 on branch `task/82`, main at `99a042e` (includes #78 M6 backend, #80 M6/M7 UI, #81 SEC-M5-M7 review) |
| **Scope** | [test-strategy.md](./test-strategy.md) §6 line 233: all `MOD-*`, `CLS-*`, `AIF-*`, `CFG-*`, `TMR-*` P0; `AIF-008` with zero counter-examples; `E2E-002..005`, `E2E-008`; `SEC-008`; `CFG-004`, `AZ-015`; `A11Y-004`; `E2E-003`. Plus closure of every P0 in [m5-m7-security review](../security/m5-m7-security-review.md) |
| **Rule** | PASS = zero open P0 defects **and** all P0 cases asserted by named tests |

## Verdict

**FAIL.** Every named M6 gate case is asserted by a named test, and `AIF-008` has zero counter-examples. But **both launch-blocking P0 findings of SEC-M5-M7 are still open on `main`** (QA-M6-01, QA-M6-02), so the rule "zero open P0" is not met. Unit-level M6 logic is correct; what fails is wiring: the live system does not use it (see QA-M6-02).

## 1. Evidence

| Layer | Command | Result |
|---|---|---|
| Unit and in-memory integration | `DATABASE_URL=<ci placeholder> pnpm --filter @rp/core --filter @rp/worker --filter @rp/web exec vitest run` | core 550, worker 267, web 831 (+1 todo) pass before this task; **new gate files pass** (core +8, web +9) |
| Gate files added (test code only) | `packages/core/src/moderation/m6-gate.test.ts`, `apps/web/src/server/m6-gate.test.ts` | pass; typecheck and eslint clean |
| `pnpm -r test` raw | `@rp/db` `prisma validate` needs `DATABASE_URL` | exit 1 without the variable (environment, same as earlier gates; CI sets it) |
| Browser E2E | `E2E-002/003/004/005/008`, `A11Y-004` specs in `apps/web/e2e/m6-*.spec.ts` | **NOT RUN** here: need MySQL, Redis, built app, worker, Chromium. CI job **`e2e`** (`.github/workflows/ci.yml:58`, `pnpm --filter @rp/web test:e2e`). Specs exist and are listed in the playwright run |
| Real MySQL for `*.int.test.ts` | those suites use `MemoryStore` / `makeFakeDb`, not MySQL | **NOT RUN** against MySQL; CI job `e2e` exercises the DB only through the browser specs. No CI job runs the int suites on MySQL |
| Real AI provider | prompt-injection against a live model | **NOT RUN** (no provider in sandbox, and the live path does not call one: QA-M6-02) |

No secret was read.

## 2. Per-case results

**PASS** = a named test asserts the case. **PASS (E2E, NOT RUN)** = spec exists, needs CI job `e2e`.

| ID | Result | Evidence |
|---|---|---|
| MOD-001..006, 008..010, 013..014 | **PASS** | generated per-row tests `transitions.test.ts:62` (`T1`..`T13`, audit, decision, outbox, deadlines); MOD-008/013 also `strikes.test.ts`, `m6.int.test.ts` (appeal overturn); new named `m6-gate.test.ts` "MOD-009 / MOD-010", "MOD-014" |
| MOD-007 | **PASS** | `transitions.test.ts:140`; new "MOD-007 T6 unknown reasonCode" (no state change, zero writes) |
| MOD-015 | **PASS** | `transitions.test.ts` "MOD-015 edit limit: 6th edit" |
| MOD-016 | **PASS** | "MOD-016 negative matrix" (over 100 pairs, zero writes) |
| MOD-017 | **PASS** | new "MOD-017": no row leaves DELETED; repeat T13 adds no audit/outbox |
| MOD-018 | **PASS** | new "MOD-018" (table) and "MOD-018 runtime" (STAFF_APPROVE on REJECTED -> `InvalidTransition`, no writes) |
| MOD-019 (M4) | **PASS** | `apps/worker/src/m4.test.ts`, `packages/core/src/m4.test.ts` |
| MOD-020 | **PASS** | `transitions.test.ts:206` "fault in ..." (rollback, no half state) |
| MOD-021 | **PASS** | `transitions.test.ts:122,132` (lease at commit, two concurrent decides: one applies) |
| MOD-022 | **PASS** | new `apps/web/src/server/m6-gate.test.ts` "MOD-022: 50 reports from NEW accounts" (review stays PUBLISHED, one case, weight 0); `m4.test.ts` RPT-003 |
| CLS-001..010, 012, 013 | **PASS** | `classify.test.ts` (one named test per id); CLS-012 also `transitions.test.ts:180` |
| AIF-001..005 | **PASS** | `ai/provider.test.ts` (retry schedule 5/20/60 s, 429/5xx, schema, language, breaker) |
| AIF-006 | **PASS** | `apps/worker/src/moderation/sweep.int.test.ts:26` |
| AIF-007 | **PASS** | `assess.int.test.ts` (max 3 rescans, hold clock not reset) |
| **AIF-008** | **PASS, zero counter-examples** | `moderation/assess.property.test.ts:37-41`: 400 generated provider outputs plus 100 failure kinds/arbitrary error messages; none returns CLEAN. Core suite green |
| CFG-001, 002, 003 | **PASS** | `config.test.ts`, `classify.test.ts`, `transitions.test.ts:256` |
| **CFG-004** | **PASS** | `m6.int.test.ts:19,33` (requester cannot activate, second ADMIN approves, previous ACTIVE -> RETIRED, audit with diff); `approvals.test.ts` |
| TMR-001..004, 006..011, 013 | **PASS** | `sweep.int.test.ts:42-121` (flushed queue, 168 h, DST in UTC steps, simultaneous approve/expire, stale-deadline no-op), `transitions.test.ts:220-271` |
| TMR-014 | **PASS (static)** | new "TMR-014": no `NOW()`/`CURRENT_TIMESTAMP`/`UTC_TIMESTAMP` in non-test moderation code (core and worker); deadlines use `clock.now()`. A skewed-DB-clock run on MySQL is **NOT RUN** (no MySQL int suite in CI) |
| **SEC-008** | **PARTIAL** | `ai/prompt.test.ts`, `ai/provider.ts`: the strict scores-only schema and fixed system prompt make an injected "return CLEAN" structurally unable to set a verdict. Not exercised end to end because the live queue never calls this pipeline (QA-M6-02) |
| **AZ-015** | **PASS** | `approvals.test.ts`, `m6.int.test.ts:49` (ADMIN cannot grant ADMIN; SUPER_ADMIN grant needs a second SUPER_ADMIN **in the library**). The route does not use it: QA-M6-01 |
| **A11Y-004** | **PASS** (component) / **E2E NOT RUN** | `m6-ui.a11y.test.tsx` (27 tests); `e2e/m6-queue-keyboard.spec.ts` needs CI job `e2e` |
| **E2E-002, 003, 004, 005, 008** | **PASS (E2E, NOT RUN)** | `e2e/m6-hold-appeal.spec.ts:10,34,46,78`, `e2e/m6-coi.spec.ts:6`; UI-level assertions in `m6-ui.a11y.test.tsx` pass. CI job **`e2e`** |

P1 cases `MOD-011/012`, `CLS-011`, `AIF-009`, `CFG-005`, `TMR-005`, `TMR-012` are not gate items; `MOD-011`, `TMR-005`, `TMR-012` are asserted in `sweep.int.test.ts`.

## 3. SEC-M5-M7 P0 closure

| Finding | Status | Test |
|---|---|---|
| SEC-M6-01 role grant bypasses four-eyes | **OPEN** | `m6-gate.test.ts` (web) `it.fails` "the staff roles route must call requestRoleGrant", "userRole.upsert/create appears only in approvals.ts" |
| SEC-M6-02 production moderation is the mock blocklist | **OPEN** | `it.fails` "createModerationProvider refuses mock/unset in production", "queue handler publishes through runAssess" |

These tests are `it.fails`: green while the defect is open, **red as soon as the fix lands**, so the fixer must delete `.fails` and the assertion then guards the fix. No production file was changed.

## 4. Defects

| ID | Sev | Title | file:line | Fix owner |
|---|---|---|---|---|
| **QA-M6-01** | **P0** (= SEC-M6-01) | One SUPER_ADMIN can grant ADMIN/SUPER_ADMIN directly; `requestRoleGrant` is never called. AZ-015 / CFG four-eyes holds in the library only | `apps/web/src/app/api/admin/staff/[id]/roles/route.ts:15`; `apps/web/src/server/staff-roles.ts:33-52` | Backend, per the fix in the SEC review |
| **QA-M6-02** | **P0** (= SEC-M6-02) | `MODERATION_PROVIDER` defaults to `mock`; the queue calls legacy `processModeration`, so text without a blocklist word is auto-APPROVED. M6 `assess`, SEC-008 defences, AIF-001..008 are not on the live path | `packages/core/src/moderation-provider.ts:61`; `apps/worker/src/processors.ts:19,65`; `apps/worker/src/moderation.ts:115-116` | Backend |
| QA-M6-03 | P1 (= SEC-M6-04) | `two_factor_reset` alert is SKIPPED | `apps/web/src/server/approvals.ts:108`; `apps/worker/src/email.ts:110-124` | Backend |
| QA-M6-04 | P1 | Int suites run on in-memory fakes only; no CI job runs state, timer and config invariants (MOD-020/021, TMR-014) against MySQL | `.github/workflows/ci.yml` (no job) | DevOps/QA |

## 5. NOT RUN, with CI job

| Item | CI job |
|---|---|
| `E2E-002/003/004/005/008`, `A11Y-004` browser specs | `e2e` (exists, `ci.yml:58`); not run in this sandbox |
| MySQL-backed int suites (MOD-020/021, TMR-014 skew) | **none** (QA-M6-04) |
| Live AI provider canary (SEC-008) | **none**; blocked by QA-M6-02 |

## 6. To reach PASS

1. Fix QA-M6-01 and QA-M6-02 as specified in the SEC review; remove `.fails` from the matching tests; they must pass.
2. Run CI job `e2e` and attach the result for `E2E-002..005`, `E2E-008`, `A11Y-004`.
3. Re-run this gate.
