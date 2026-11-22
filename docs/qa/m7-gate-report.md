# M7 QA gate report

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Task** | #82 on branch `task/82`, main at `99a042e` (includes #79 M7 backend, #80 UI, #81 SEC review) |
| **Scope** | [test-strategy.md](./test-strategy.md) §6 line 234: `TRS-001..004`, `TRS-008`, fake-review burst routing verified, `TRS-009`, `SCOPE-001`. Plus the P0 closure check shared with [m6-gate-report.md](./m6-gate-report.md) |
| **Rule** | PASS = zero open P0 defects **and** all P0 cases asserted by named tests |

## Verdict

**FAIL.** The M7 libraries are correct and every gate case has a named test, but **the controls are not wired**: no production code calls burst routing, vote-anomaly freeze, trust recompute or decay (QA-M7-01). "Fake-review burst routing verified" can be verified only at library and fake-store level, not on the live path. The two open SEC-M5-M7 P0s (QA-M6-01, QA-M6-02) also block the combined gate.

## 1. Evidence

| Layer | Command | Result |
|---|---|---|
| Unit / in-memory integration | `DATABASE_URL=<ci placeholder> pnpm --filter @rp/core --filter @rp/worker --filter @rp/web exec vitest run` | all pass (core 550, worker 267, web 831 before; gate files added) |
| Gate file (test code only) | `apps/web/src/server/m6-gate.test.ts` | pass; the wiring assertions are `it.fails` (green while defect open) |
| MySQL-backed burst/trust | `apps/worker/src/trust/burst.int.test.ts` uses fakes | **NOT RUN** on MySQL; **no CI job** |
| Browser | none of the M7 gate rows is `E` except `TRS-009` | **NOT RUN**, CI job `e2e` has no notification-preference spec (QA-M7-03) |

## 2. Per-case results

| ID | Result | Evidence |
|---|---|---|
| **TRS-001** | **PASS (unit) / defect live** | `trust.test.ts:15` (NEW vote weight 0 until 7 days, verified email, N actions; 30-day re-weight), `apps/web/src/server/m4.test.ts`. Live: nothing recomputes `trustBand` (QA-M7-01), so every user stays at the default band |
| **TRS-002** | **PASS (unit) / defect live** | `trust.test.ts:35,41` (frozen votes stored not counted; >20/h, low-trust share, shared IP trigger). `votesFrozenAt` is read at `apps/web/src/server/votes.ts:41` but nothing sets it |
| **TRS-003** | **PASS** | `trust.test.ts:53` (20 copies/paraphrases over 5 accounts flagged, 20 unrelated not), `:72` same-author not flagged. Evasion by paraphrase: SEC-M7-03 (P2) |
| **TRS-004** | **PASS (fake store) / defect live** | `trust.test.ts:82,90` (over 10/h or 5 low-trust/h -> burst, `PRODUCT_BURST`, ends last+60 min); `worker/src/trust/burst.int.test.ts:26` (burst reviews end in lane HOLD, excluded from the aggregate until a human decision) |
| **TRS-008** | **PARTIAL** | `trust.test.ts:132,144,147` (each event maps to one signal, duplicate yields one row, no signal for expiry/lapse/delete/hide). `REVIEW_PUBLISHED` and `CONTENT_ACTIONED_AGAINST` mappings pass. `MALWARE_UPLOAD` has a mapper (`signals.ts:41`) but the media worker never emits that event (carry-over QA-M5-08). Not a gate failure on its own, listed as a gap |
| **Fake-review burst routing** | **FAIL (live)** | `routeReview` and `applyBurst` have no production caller (`apps/worker/src/trust/routing.ts:17,42`); `core-main.ts` registers no trust or burst job. Pinned by `m6-gate.test.ts` `it.fails` "routeReview is referenced outside tests" |
| **TRS-009** | **PASS (unit)** | `notifications.test.ts:16,20,25` (preference PUT for a mandatory type -> 422 `mandatory_notification`; a DB row `enabled=false` for `CONTENT_REMOVED` still yields in-app and e-mail; all mandatory types survive disabled prefs). The catalogue type is `E`; no browser spec (QA-M7-03) |
| **SCOPE-001** | **PASS** | `apps/web/src/scope.test.ts:19-40` (no `message.*` permission, no messaging routes, no Prisma message/conversation model, no `MESSAGE*` notification type, no compose UI); `notifications.test.ts:43` |

## 3. Defects

| ID | Sev | Title | file:line |
|---|---|---|---|
| **QA-M7-01** | **P0 for this gate** (SEC-M7-01 rates it P1; escalated because the gate item "burst routing verified" cannot be met and TRS-001/002/004 are inert live) | Burst routing, vote freeze, trust recompute/decay and the notification dispatcher are not called by any production path; users stay at the schema-default band so every vote has weight 0 | `apps/worker/src/trust/routing.ts:17,42`; `apps/worker/src/trust/recompute.ts:14,34`; `packages/core/src/trust/votes.ts:35`; `packages/core/src/notifications/dispatch.ts:17`; `apps/worker/src/core-main.ts` (no registration) |
| QA-M7-02 | P1 (carry-over QA-M5-08) | `MALWARE_UPLOAD` trust signal has no emitter | `packages/core/src/trust/signals.ts:41`; `apps/worker/src/media.ts` (no emit) |
| QA-M7-03 | P2 | TRS-009 is typed `E` but has no browser test of the preferences UI | `apps/web/e2e/` (absent) |
| QA-M7-04 | P2 (= SEC-M7-02/03/04) | Sock-puppet follow e-mail, 60-minute-only burst window, vote weight read at write time | `packages/core/src/notifications/dispatch.ts:12-13`; `packages/core/src/trust/burst.ts:2`; `apps/web/src/server/votes.ts:41` |

## 4. SEC-M5-M7 P0 closure

Both P0s (SEC-M6-01, SEC-M6-02) are **OPEN**; see [m6-gate-report.md](./m6-gate-report.md) §3 for the pinning tests. No P0 is specific to M7.

## 5. NOT RUN, with CI job

| Item | CI job |
|---|---|
| MySQL-backed burst and trust integration | **none** (add a service-container job) |
| `TRS-009` browser path | `e2e` (spec missing, QA-M7-03) |
| Burst routing through the live worker | blocked by QA-M7-01; then CI job `e2e` with the worker started (`ci.yml`) |

## 6. To reach PASS

1. Wire the M7 entry points (QA-M7-01) and fix QA-M6-01/02; remove `.fails` from the matching tests in `apps/web/src/server/m6-gate.test.ts`.
2. Add a live-path burst test (worker + DB) and the TRS-009 browser test.
3. Re-run this gate.
