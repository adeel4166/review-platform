# M4 QA gate report

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Task** | #71 (M4-05) on branch `task/71`, main at `736125c` (includes #67, #68, #70) |
| **Scope** | Every M4 P0 case in the spec. **Note:** the task text names `docs/architecture/m4-spec.md`, but the file is [m4-m5-spec.md](../architecture/m4-m5-spec.md); the case list is its §13. M5 cases (`MED-04x`, `INF-006..008`) are out of the M4 gate |
| **Predecessor** | [m3b-gate-report.md](./m3b-gate-report.md) (PASS) |

## Verdict

**FAIL.** The acceptance rule is "PASS only with zero open P0 defects and **all P0 cases asserted by named tests**". The code is green, but 5 P0 cases lack a named assertion and 2 more are NOT RUN (live DB) (§2). Nothing found is a failing product behaviour. These are missing assertions or runtime-only parts, plus one P1 defect (QA-M4-01). The production source was not changed (QA manifest); this run added 17 tests in `apps/web/src/server/m4-gate.test.ts` and `apps/worker/src/m4-gate.test.ts`.

## 1. Evidence (branch `task/71`)

| Layer | Command | Result |
|---|---|---|
| Full QA script | `pnpm qa` (lint, typecheck, tests, design:check) | **pass**, exit 0. core 400, worker 181, web 672 passed + 1 todo (+17 new gate tests) |
| E2E (Playwright) | `apps/web/e2e/m4-ui.spec.ts` (E2E-M4-001..004) | **NOT RUN** (needs MySQL, Redis, MinIO, built app; CI job `e2e`) |
| Live MySQL checks | | **NOT RUN** (no running server on this host) |

`DATABASE_URL` is the throwaway CI placeholder. No secret was read.

## 2. Per-case results (spec §13, P0 and the task's named areas)

**PASS** = a named test asserts the whole case. **GAP** = no named assertion for part of it (counts against the gate). **NOT RUN** = needs MySQL or E2E.

| ID | Area | Result | Evidence or gap |
|---|---|---|---|
| VOT-001 | votes, COI | **PASS** | `packages/core/src/m4.test.ts` "VOT-001 authorizeVote matrix"; web "self-vote, seller member, restriction, unverified, non-published" |
| VOT-002 | votes | **PASS** | web `m4.test.ts` "PUT / switch / DELETE keep counters in step; same value is a free no-op" |
| VOT-003 | votes | **NOT RUN** | 50 concurrent writes need MySQL. Relative increments are used (`votes.ts`) but not asserted live |
| VOT-004 | limits | **PASS** (new) | `m4-gate.test.ts` "VOT-004: the 61st vote write ... 429 with Retry-After", "NEW account ... 21st write" |
| REV-001 | D-1 | **PASS** | "REV-001 D-1 regression: outbox payloads parse with moderationJobSchema" |
| REV-002 | edits | **PASS** | "R1: live edit keeps the old text, writes revision v2 and review.edited" |
| REV-003 | edits | **PASS** | web "second edit supersedes ..."; worker "a late job for a superseded version is a no-op" |
| REV-004 | limits | **PASS** (new) | stale version 409 (existing); "REV-004: the 6th live edit in a day is 429" (new) |
| REV-005 | edits | **PASS** | "rejected/removed -> not_editable; deleted/other user -> 404" |
| REV-006 | authz | **PASS** | "revisions visible to author and staff only"; new static pin: no public route uses `listRevisions` |
| REV-007 | media per revision | **GAP** | claim and detach on edit asserted. **Not asserted:** an asset not READY at approval is detached and never public; an added asset stays non-public until approval |
| RPT-001 | reports | **PASS** | "202 for review and seller reply; own content -> SELF_REPORT; non-public -> 404" |
| RPT-002 | reports, limits | **PASS** (new) | idempotent repeat (existing); "RPT-002: the 21st report in a day is 429" (new) |
| RPT-003 | reports | **PASS** | "RPT-003: reports from NEW accounts never take content down ..." |
| RPT-004 | reports | **NOT RUN** | two concurrent first reports need MySQL (`openReportKey` unique) |
| RPT-005 | reports, COI | **GAP** | remove, dismiss, supersede and COI asserted (`review.removed` event). **Not asserted:** the `CONTENT_REMOVED` email text carries the reasons (worker `sendProofNotice` path has no test for `review.removed`) |
| RPT-006 | reports | **PASS** | approve/reject refuse report cases; dismiss after removal `invalid_transition` |
| RPT-007 | PII canary | **PASS** (new) | canary absent from audit and outbox (existing); new: no `dangerouslySetInnerHTML` anywhere in `apps/web/src`, and `reports.ts` never puts `details` into log, audit or outbox statements. Escaping in the staff UI is by React default (static pin, no DOM render of a report) |
| PRV-014 | proof eligibility, limits | **PASS** (new) | eligibility matrix (existing); "PRV-014: the 6th proof creation in a day is 429" (new) |
| PRV-015 | queue, concurrency | **PASS** (partial live) | "decide needs filesReadyAt ... second decision 409". True concurrent commit needs MySQL |
| PRV-016 | no auto-verify | **PASS** | core "PROOF_AUTO_VERIFY=true refuses to start"; worker "processModeration never sets the verified label" |
| PRV-017 | label invariant | **PASS** (static) / **NOT RUN** (live) | new pin on `chk_review_verified_label` and four proof CHECKs; all-fields-in-one-tx asserted in "VERIFIED sets the label fields together". Raw SQL rejection needs MySQL |
| PRV-018 | staff view | **PASS** | "PRV-018: staff detail signs redacted pages only and audits each view" |
| PRV-019 | expiry | **PASS** | worker "PRV-019 ..."; sweep for SLA expiry |
| PRV-020 | AI skipped | **PASS** | worker "PRV-020 ..." |
| PRV-021 | assessment | **PASS** | core "PRV-021 proofAssessment strips unknown keys" |
| PRV-022 | retention | **PASS** | core "PRV-022: retention AT_DECISION vs APPEAL_WINDOW"; worker "PRV-006/022 ... legal hold blocks"; "sweeps ... retention of redacted copies" |
| PRV-023 | redaction, no network | **GAP** | "PRV-005/023: fail-closed redaction ... fully masked" passes and a new static pin shows the proof pipeline imports no network client. **No sandbox or no-network probe exists**: the OCR adapter and `media` group sandbox are M5-02, and the worker wires `failClosedRedactor` only (`processors.ts:32`) |
| PRV-001 | PII canary | **PASS** (new) | worker `m4-gate.test.ts` "PRV-001 PII canary": a fake OCR returning an order number, name, `ocrText` and boxes leaves none of them in proofs, files, outbox, trust signals or console output |
| PRV-004 | provider sees redacted only | **PASS** | worker "PRV-004: extractor sees redacted bytes only" |
| PRV-005 | fail closed | **PASS** (new part) | full mask when OCR is unavailable (existing); new: a throwing redactor never yields a READY derivative or `filesReadyAt` |
| PRV-006 | purge | **PASS** | "PRV-006/022: purge ... filesPurgedAt only after HEAD 404" |
| PRV-007 | label survives purge | **GAP** | no named test; the purge test does not assert the review's label fields after purge |
| PRV-008 | duplicate order | **PASS** | web "same order on another account is flagged"; worker "PRV-025/008 ... TrustSignal, not verified" |
| PRV-009 | keyed HMAC | **PASS** | core "PRV-009/024 order reference hashing" |
| PRV-013 | revoke | **PASS** | "PRV-013: revocation clears the label, leaves the proof row, writes enforcement + email event". Step-up is a route concern, not unit-tested |
| SEC-004 | limits | **PASS** (new) | votes, reports, edits, proofs, plus ipHash caps and a static check that each route calls its limiter |
| SEC-009 | vote unique, self | **PASS** | covered by VOT-001, VOT-002 |
| AZ-012, AZ-022, AZ-023 | authz matrix | **PASS** | seller member refused (VOT-001); non-public 404 (RPT-001, REV-006); non-author edit, proof create and detail 404 |
| SEL-013 | incentive on edit | **GAP** | `editOwnReview` carries `incentive` (`reviews.ts:89`), but no test asserts a re-validation or a changed incentive on edit |
| OUT-008 | outbox routes | **PASS** | worker "scans apps/web and apps/worker sources" |
| MOD-019 | live edit | **PASS** | core "MOD-019 revision path (R2-R6)"; worker "CLEAN edit publishes version 2" |
| Break-glass | proof view | **see QA-M4-01** | The spec defers `proof.view_original` to M6; M4 shows redacted pages only. The UI break-glass prompt is not enforced server-side |
| UI a11y | A11Y-003, A11Y-010 | **PARTIAL** | `m4-ui.a11y.test.tsx` axe runs on card, vote, report, own actions, proof panel, admin queue. 24 px target size and keyboard attach flow are not asserted by name |
| UI e2e | E2E-M4-001..004 | **NOT RUN** | CI only |

### P0 totals (44 distinct P0 ids above, AZ-012/022/023 counted as 3)

PASS 37 (PRV-015 and PRV-017 pass with a live-MySQL part still NOT RUN), GAP 5 (REV-007, RPT-005, PRV-007, SEL-013, PRV-023), NOT RUN 2 (VOT-003, RPT-004), plus the E2E set. A GAP means the gate rule "all P0 asserted by named tests" is not met.

## 3. Defects

No tracker access from this sandbox; these are reports for the platform to file.

| ID | Pri | Status | Area | Summary | Evidence | Blocks gate |
|---|---|---|---|---|---|---|
| QA-M4-01 | P1 | open | break-glass | The admin proof queue asks for a reason and sends `X-Access-Reason` (`ProofsQueue.tsx:106`). The server never reads it: `getProofDetail` audits the view, but a request with no header returns the detail. The prompt is cosmetic | `m4-gate.test.ts` "the admin proof detail route reads the access reason server-side" is an `it.fails` pin. It flips to a failing test when fixed; then make it a plain `it` | No (spec defers break-glass to M6) |
| QA-M4-02 | P0 (assertion gap) | open | REV-007, RPT-005, PRV-007, SEL-013 | Four P0 cases lack a named test for the part listed in §2 | §2 | **Yes** |
| QA-M4-03 | P0 (assertion gap) | open | PRV-023 | No sandbox or no-network probe for redaction. Only the fail-closed full-mask redactor is wired; the OCR adapter and sandbox are M5-02 | `processors.ts:32` | **Yes**, until the case is moved to M5 by the spec owner or the probe exists |

## 4. Required to reach PASS

1. Add named tests for REV-007 (approval-time detach of a non-READY asset), RPT-005 (reasons in the `review.removed` notification), PRV-007 (label fields unchanged after purge) and SEL-013 (edit re-validates incentive).
2. Decide PRV-023: implement the sandbox probe, or have the spec owner move it to M5 (the spec §13.6 lists it as M4 P0).
3. Run the CI jobs: live MySQL (VOT-003, RPT-004, PRV-015 concurrency, PRV-017 raw SQL) and `e2e` (E2E-M4-001..004).
4. Fix QA-M4-01 and convert its `it.fails` to a plain `it`.

## Reproduce

```bash
export DATABASE_URL=mysql://app:app@127.0.0.1:3306/ci   # throwaway CI placeholder
pnpm qa
pnpm --filter @rp/web exec vitest run src/server/m4.test.ts src/server/m4-gate.test.ts
pnpm --filter @rp/worker exec vitest run src/m4.test.ts src/m4-gate.test.ts
pnpm --filter @rp/core exec vitest run src/m4.test.ts
```

## History

- **task #71 (M4-05, this report):** FAIL. 37 of 44 P0 PASS, 5 GAP, 2 NOT RUN (live DB), E2E NOT RUN. 17 gate tests added. QA-M4-01 (P1) opened.
- **task #75 (close-out):** QA-M4-01 fixed (`getProofDetail` requires `X-Access-Reason`, 10-200 chars, stored in the audit row; the `it.fails` pin is a plain `it`). QA-M4-02 named tests added: REV-007, SEL-013 (`apps/web/src/server/m4.test.ts`), RPT-005 and PRV-007 (`apps/worker/src/m4-close.test.ts`). RPT-005 exposed a gap, fixed: the removal email now carries the reason category as well as the public reason. QA-M4-03 / PRV-023: no-network probe added in `apps/worker/src/m4-close.test.ts`; the OCR adapter is not ready, so `failClosedRedactor` stays wired. VOT-003, RPT-004 and E2E remain CI-only (live MySQL).
