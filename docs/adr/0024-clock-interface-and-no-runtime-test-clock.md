# ADR-0024: Injected `Clock` for all deadline logic, and no runtime test-clock hook in any build

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #77 (M6–M8 spec) |
| **Related** | [test-strategy.md](../qa/test-strategy.md) §3 (fake clock, server-side test clock), §10 item 4 · [m6-m8-spec.md §2](../architecture/m6-m8-spec.md#2-clock-fakeclock-and-the-test-clock-decision-adr-0024) · catalogue `TMR-*`, `TMR-014`, `OPS-003`, `OPS-006`, `E2E-003`, `E2E-005` |

## Context

1. Every M6 timer (hold expiry, post-review SLA and lapse, AI pending guard, appeal window, appeal SLA, lease expiry)
   and every M8 retention job compares "now" with a stored deadline. The code today calls `new Date()` / `Date.now()`
   directly (about 85 non-test call sites in `packages/core`, `apps/worker` and `apps/web/src/server`), so none of
   that can be tested at a boundary (`TMR-003`: one millisecond before the deadline is a no-op).
2. `TMR-014` requires that deadlines follow the app clock even when the database clock is skewed, so `NOW()` in SQL
   and implicit `@default(now())` values must not feed a deadline.
3. Test-strategy §3 allowed a server-side test clock override "only when `NODE_ENV=test`", and asked the Architect to
   decide the hook (§10 item 4). `OPS-003` then has to prove the hook is absent from production. A hook that is
   compiled in and switched off by an env var is exactly the class of bug `OPS-003` exists to catch.

## Decision

1. **`Clock` interface** in `packages/core/src/clock.ts`:
   `interface Clock { now(): Date }`, `systemClock`, and pure helpers `addMs`, `addHours`, `addDays` that work on
   epoch milliseconds (UTC). "7 days" is always `+ 168 h`, never "same local time 7 calendar days later" (`TMR-004`).
2. **Injection, not globals.** Every domain service, transition, timer handler, sweeper and retention job takes
   `clock` in its dependency object. Composition roots (`apps/web/src/server/deps.ts`, `apps/worker/src/core-main.ts`)
   pass `systemClock`. No module-level singleton is mocked.
3. **Timestamps that feed a deadline or a guard are written explicitly** from `clock.now()` (for example
   `ModerationCase.createdAt`, which drives the AI pending guard). SQL never uses `NOW()`/`CURRENT_TIMESTAMP` in a
   `WHERE` clause; sweepers pass `:now` as a parameter.
4. **`FakeClock`** lives in `packages/core/src/testing/fake-clock.ts` (`set`, `advance`, starts at a fixed UTC
   instant). Everything under `src/testing/` carries the sentinel string `__RP_TEST_ONLY__` and may be imported only
   by `*.test.ts`, `*.int.test.ts`, `test/**` and `e2e/**` (ESLint `no-restricted-imports`).
5. **No runtime test-clock hook.** Neither the web app nor the worker has a route, header, env var or Redis key that
   moves its clock, in any build. E2E journeys that need "time has passed" **seed absolute deadlines in the past**
   (for example `holdExpiresAt = now − 1 min`) through the E2E seeding helper, which writes to the test database
   directly, and let the real sweeper act. The E2E stack sets `MODERATION_SWEEP_INTERVAL_MS=5000` (bounded 5 s–10 min
   in the env schema, so it is a legal production value, not a hook). Countdown text in the UI is driven by the
   Playwright clock API in the browser only.
6. **Lint gate.** `no-restricted-syntax` bans `Date.now()` and zero-argument `new Date()` in
   `packages/core/src/**`, `apps/worker/src/**` and `apps/web/src/server/**` (non-test), except `clock.ts`. It is an
   error for M6 modules from day one and a warning elsewhere until the M8 sweep turns it into an error.
7. **`OPS-003`** is a build-output check (`scripts/ops003-no-test-hooks.mjs`, CI job after `next build` and the worker
   build): no `__RP_TEST_ONLY__` sentinel and no `FakeClock` symbol in `.next/server/**` or `apps/worker/dist/**`, and
   no route under `/api/__test__`, `/api/test` or `/api/e2e` in the Next route manifest.

## Alternatives considered

| Option | Why not |
|---|---|
| Env-gated test route (`POST /api/__test__/clock` when `NODE_ENV=test`) | The code ships in the production bundle and is one mis-set variable away from letting anyone move deadlines. `OPS-003` could only check the flag, not the absence |
| Build-time module alias (`@rp/clock-impl` → test implementation in an E2E build) | Safe, but the E2E build is then not the production build, and every alias is a second build to maintain. Seeding deadlines gives the same coverage |
| Mock `Date` globally (`vi.useFakeTimers`) in integration tests | Also freezes BullMQ, Prisma and socket timers in the same process. Flaky, and invisible in the code under test |
| Use DB `NOW()` for deadlines | Cannot be driven by a fake clock and breaks `TMR-014` |

## Consequences

**Positive:** timer boundaries become plain unit/integration tests; the production artefact provably contains no
time-travel code; E2E stays on the production build.

**Negative / risks:** about 85 call sites must be migrated (M6 does the moderation/appeal/timer paths; M8 the rest).
E2E cases cannot test "the server waits N hours", only "the server acts on a deadline already in the past". Integration
tests cover the waiting with `FakeClock`.

## Follow-ups

- QA: reword test-strategy §3 "Server-side test clock for E2E" to "seeded deadlines, no hook" and keep `OPS-003` P0.
- Backend (M6-A): `clock.ts`, `testing/fake-clock.ts`, lint rule, composition roots.
