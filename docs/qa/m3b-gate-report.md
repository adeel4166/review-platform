# M3b QA gate report (task #63, re-run after M3b-11)

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Branch** | `task/63` |
| **Scope** | M3b: every P0 case in [m3b-spec.md §10](../architecture/m3b-spec.md#10-test-cases-for-qa), the 17 PARTIAL P0 cases from the task #59 report, verification of QA-M3B-01..05, regression pins, the 2FA bypass sweep, transfer-abuse cases, the business-email corpus, the seller-reply matrix, and the T-08 SEC-07 runtime check on MinIO |
| **Catalogue** | [test-case-catalogue.md](./test-case-catalogue.md) |
| **Predecessors** | [task #59 report](#history) (FAIL), [m3-gate-report.md](./m3-gate-report.md) (M3a) |

## Verdict

**FAIL. The M3b gate does not pass.** Acceptance is "zero open P0 defects" and "all §10 P0 cases PASS, or NOT RUN for E2E or runtime only".

1. **Three P0 defects are open** (new in this run): QA-M3B-06, QA-M3B-07, QA-M3B-08 (§4). Each is a real product gap, not a test gap.
2. **Five P0 cases are NOT RUN.** SEL-022, SEL-026 and RPL-011 need live MySQL, SEL-034 (signed-out part) needs the route and session harness, and RPL-006 is the E2E DOM check. Each has a passing static or unit part.
3. **T-08 MinIO runtime is NOT RUN.** The static config is fixed (§5).
4. **E2E is NOT RUN** (Playwright specs need CI services).

Everything else in the gate is green: `pnpm qa` (lint, typecheck, all suites, design check) exits 0 with core 374, worker 152, web 559 passing and 2 todo.

The production source was **not** changed. The QA operating manifest forbids modifying production source, so the defects are reported here instead of fixed. The task text asked for minimal fixes, and that is the main deviation from the brief.

## 1. Evidence (this run, branch `task/63`)

| Layer | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | **pass** (exit 0). QA-M3B-03 is closed |
| Typecheck | `pnpm typecheck` | **pass** (all packages) |
| Unit and integration | `DATABASE_URL=<ci placeholder> pnpm -r --no-bail test` | **pass**: core 374, worker 152, web 559 passed, 2 todo (was 1,012 in task #59; 73 new named assertions) |
| Full QA script | `pnpm qa` | **pass** (exit 0) |
| E2E (Playwright) | `pnpm --filter @rp/web test:e2e` | **NOT RUN** (needs MySQL, Redis, MinIO and a built app; CI only) |
| T-08 MinIO runtime | `pnpm infra:up && bash scripts/t08-minio-check.sh` | **NOT RUN** (no Docker in this sandbox; starting a server is outside the QA role) |

`DATABASE_URL` is the throwaway CI placeholder. No secret was read or printed. `/usr/sbin/mysqld` exists on the host, but no server is running and starting one is outside the QA role, so every live-DB check stays NOT RUN.

## 2. Per-case results

Result key: **PASS** means a named test asserts the whole case. **FAIL** means a defect (§4). **NOT RUN** means the remaining part needs MySQL, E2E or MinIO and is listed in §5.

### 2.1 The 17 cases from task #59 §4

| ID | Pri | Result | Evidence (named test) or gap |
|---|---|---|---|
| AUT-013 | P0 | **PASS** | `two-factor.test.ts` "AUT-013: canaries never reach console output": TOTP secret (base64, hex), code, recovery code and session ids absent from every console method during verify, failure and recovery. Audit and outbox canaries are covered by the existing test |
| AUT-022 | P0 | **FAIL** | "three failures on one pending session ... exactly one SECOND_FACTOR_FAILURES alert" **PASS**. The spec's hourly limit is **not** implemented: `two-factor.ts:133` alerts on the third failure of every session. QA-M3B-06 (`it.fails` test pins it) |
| SEL-020 | P0 | **PASS** | `ownership-transfers.test.ts` "SEL-020: status x action matrix": 24 cases (accept, cancel, staff cancel, cancel link × 6 statuses). Refusals assert no row change and no audit row |
| SEL-021 | P0 | **PASS** | Existing named test covers OWNER + 2FA + step-up, MANAGER → `FORBIDDEN_ROLE`, and "a second open change -> ownership_change_pending". The code string exists (`ownership-transfers.ts`). QA-M3B-05 was a stale grep |
| SEL-022 | P0 | **NOT RUN** (live part) | "chk_transfer_delay is declared with the 72 h floor" is a static pin on the migration. "accepting at 1 h ... no-op at 72 h - 1 ms and completes at exactly 72 h" **PASS**. The raw-SQL insert rejected by the live CHECK needs MySQL |
| SEL-023 | P0 | **FAIL** | "no row holds the raw token; a hash-only row is found by cancelByLink" **PASS**. The worker minting and mailing of one link per recipient, and the T − 24 h reminder, **do not exist** in the repo (QA-M3B-07) |
| SEL-024 | P0 | **PASS** | "another transfer's token cannot cancel this one; after a cancel, accept -> invalid_transition" |
| SEL-025 | P0 | **PASS** | "seller suspended after acceptance -> FAILED SELLER_BLOCKED"; "target banned after acceptance -> FAILED TARGET_NOT_ELIGIBLE". Both assert no role change |
| SEL-026 | P0 | **NOT RUN** (live part) | "takes SELECT ... FOR UPDATE on the seller first" for create, accept, cancel, staff cancel, execute and member leave: **PASS**. "REMOVE_OWNER after the initiator left keeps an OWNER": **PASS**. The true concurrent interleaving needs MySQL row locks |
| SEL-028 | P0 | **PASS** | "the initiator leaving cancels the open change ... (CANCELLED_MEMBERSHIP_CHANGED)"; "an invitation with role OWNER is refused by the input schema" |
| SEL-029 | P0 | **PASS** | "an OWNER of seller S2 cannot create on S, list, accept or cancel S's change (404 each)"; "sellerId in the request body is refused (strict input schema)" |
| SEL-031 | P0 | **PASS** | `packages/core/src/domain-policy.test.ts` "SEL-031: named address corpus": quoted local part, comment, IP literal, non-ASCII local, local > 64 refused; `info+x@` is role. Named titles replace the untitled corpus entries |
| SEL-033 | P0 | **PASS** | "a role address whose token is used stays PENDING for staff: requiresHumanReview, seller PENDING_VERIFICATION, no RULE approval"; "SEL-033: reserved ... refused" (4 addresses); reserved parts in `domain-policy.test.ts` |
| SEL-034 | P0 | **NOT RUN** (signed-out part) | "claimant demoted to RESPONDER ... 403:FORBIDDEN_ROLE" **PASS**; "pending 2FA session: email-verify API paths are denied by the pending gate" **PASS** (the 401 mapping sits in middleware, not unit-tested). Signed-out → 401 needs the route and session harness (E2E) |
| SEL-035 | P0 | **FAIL** | "a DNS error backs off (nextCheckAt grows) and the claim EXPIRES at the challenge deadline, never earlier" **PASS**. "no web route injects the MX resolver" **PASS** (static). The MX requirement is **never enforced at runtime**: no worker code calls `assertHasMx` or `resolveMx`, and no route passes `lookupMx` (QA-M3B-08) |
| RPL-003 | P0 | **PASS** | "in claim grace the seller is still VERIFIED ... replies are allowed". Grace is not a separate seller status in code (`sellers.ts:82`), so the row asserts the status the gate reads |
| RPL-011 | P0 | **NOT RUN** (live part) | "chk_case_subject and RESTRICT foreign keys to reviews are declared" is a static pin. The live refusal of a review delete with cases needs MySQL |

### 2.2 Verification of earlier defects

| Defect | Status | Evidence |
|---|---|---|
| QA-M3B-01 (SEL-036 `Auto-Submitted`) | **CLOSED** | `packages/core/src/mail.ts:10` sets `Auto-Submitted: auto-generated` on every built message. "SEL-036: every built message (incl. claim_notice token mail) carries Auto-Submitted" passes |
| QA-M3B-02 (T-08 24 h lifecycle) | **FIXED IN CONFIG, runtime NOT RUN** | `docker-compose.yml` `minio-init` adds `mc ilm rule add --expire-days 1` on `rp-ingest` and sets CORS to `APP_URL`. The runtime check is §5 |
| QA-M3B-03 (`pnpm lint`) | **CLOSED** | `pnpm lint` exits 0 |
| QA-M3B-04 (AZ-028 `grantStaffRole` untested) | **CLOSED** | `apps/web/src/server/staff-roles.test.ts` imports `grantStaffRole`; 6 tests pass |
| QA-M3B-05 (SEL-021 code string) | **CLOSED** | `ownership-transfers.ts` throws `ownership_change_pending`; the SEL-021 named test asserts it |

### 2.3 Summary of P0 results (48 cases, §10 of the spec)

| Section | P0 | PASS | FAIL | NOT RUN |
|---|---|---|---|---|
| §10.1 existing | 10 | 10 | 0 | 0 |
| §10.2 2FA and sessions | 13 | 12 | 1 (AUT-022) | 0 |
| §10.3 ownership changes | 10 | 7 | 1 (SEL-023) | 2 (SEL-022, SEL-026, live parts) |
| §10.4 business-email claims | 6 | 4 | 1 (SEL-035) | 1 (SEL-034, signed-out part) |
| §10.5 seller replies | 9 | 7 | 0 | 2 (RPL-006 E2E, RPL-011 live part) |
| **Total** | **48** | **40** | **3** | **5** |

Counting detail: a NOT RUN case also has passing static or unit parts. SEL-022, SEL-026, SEL-034 and RPL-011 are counted NOT RUN because their remaining sub-assertion needs MySQL or E2E. RPL-006 is the E2E DOM check.


## 3. Regression, bypass and corpus checks

| Item | Result | Evidence |
|---|---|---|
| T-01, T-02, T-03, T-04, T-05, T-10 regression pins | **PASS** | Unchanged from task #59; suites green |
| 2FA bypass, admin routes | **PASS** | `two-factor-gate.test.ts` |
| 2FA bypass, seller routes | **PARTIAL** | AZ-026 matrix plus the SEL-029 body and cross-seller tests. No registry sweep over `/api/sellers/*` |
| Transfer abuse: missing 2FA, early completion, last OWNER, cross-seller | **PASS** | `ownership-transfers.test.ts` |
| Business-email domain corpus | **PASS** | SEL-031 and SEL-032 named corpora |
| Seller-reply cross-seller matrix and link corpus | **PASS** | RPL-001, RPL-002 |

## 4. Defects

I have no access to the ticket tracker from this sandbox, so none of these are filed yet. Each entry is a bug report for the platform to file.

| ID | Pri | Status | Area | Summary | Evidence | Blocks gate |
|---|---|---|---|---|---|---|
| QA-M3B-01 | P0 | closed | SEL-036 | `Auto-Submitted` header | see §2.2 | - |
| QA-M3B-02 | P0 | fixed in config, runtime NOT RUN | T-08 / SEC-07(3) | 24 h lifecycle and CORS | see §2.2 and §5 | Until §5 runs |
| QA-M3B-03 | P1 | closed | `pnpm lint` | `no-undef` in `scripts/preview-smoke.mjs` | lint exits 0 | - |
| QA-M3B-04 | P1 | closed | AZ-028 | `grantStaffRole` untested | `staff-roles.test.ts` | - |
| QA-M3B-05 | P1 | closed | SEL-021 | `ownership_change_pending` | code and named test | - |
| **QA-M3B-06** | **P0** | **closed (task #64)** | AUT-022 | The `SECOND_FACTOR_FAILURES` alert is not limited to one per account per hour. `two-factor.ts:133` alerts on the third failure of every session. Two sessions in the same hour raise two alerts. The spec requires one | `two-factor.test.ts` "AUT-022 ... one per account per hour" is an `it.fails` test. It flips to a failing test once the defect is fixed | **Yes** |
| **QA-M3B-07** | **P0** | **closed (task #64)** | SEL-023, SEL-024 (delivery) | Nothing in the repo mints, mails or reminds the transfer cancel links. The `seller.ownership_transfer_requested` outbox event has no consumer in `apps/worker`. No T − 24 h reminder exists. Users therefore cannot receive a cancel link, and the reminder that invalidates an earlier link is absent | `grep sellerTransferCancelToken` finds only `ownership-transfers.ts` and its test. `ownership-transfers.ts:127` writes the event with no consumer. SEL-023 has an `it.todo` | **Yes** |
| **QA-M3B-08** | **P0** | **closed (task #64)** | SEL-035 | The MX requirement is never enforced at runtime. `assertHasMx` runs only when `deps.lookupMx` is passed (`claims.ts:47`). No route passes it, and no worker code calls `assertHasMx` or `resolveMx`. A business-email claim on a domain with no MX is therefore accepted, and the rule "no MX → REJECTED no_mx by RULE" in the egress group has no implementation | `grep assertHasMx|resolveMx|lookupMx` over `apps` returns only the definitions and the optional web parameter. SEL-035 has an `it.todo` for the egress path | **Yes** |

## 5. T-08 and E2E: NOT RUN

| Sub-check | Result | Note |
|---|---|---|
| Signed content-length (runtime) | **NOT RUN** | Unit evidence only (`packages/core/src/media-presign.test.ts`, SEC-013) |
| PUT after confirm | **NOT RUN** | Known bounded TOCTOU from the M2 review |
| Bucket CORS | **NOT RUN** | Config set in `docker-compose.yml`; the runtime preflight is pending |
| 24 h lifecycle | **NOT RUN** | Config present (`minio-init`, QA-M3B-02). Verify with `mc ilm rule ls local/rp-ingest` |
| E2E: `two-factor.spec.ts`, `ownership-transfer.spec.ts`, `seller-reply.spec.ts` (RPL-006 DOM check) | **NOT RUN** | Needs MySQL, Redis, MinIO and a built app. CI job `e2e` |

The runbook is `scripts/t08-minio-check.sh` (CI job `t08-minio`). Record the host or CI output here once it runs.

## 6. Gaps and risks

1. **Three open P0 defects** (§4) block the gate.
2. **`it.fails` tests invert on fix.** The QA-M3B-06 test passes while the defect exists. It starts failing when fixed, and then should be converted to a plain `it`. A `it.fails` body that throws for an unrelated reason also passes, so review its body when touching it.
3. **`it.todo` items** (SEL-023 mint and reminder, SEL-034 signed out, SEL-035 egress path) are reported, not asserted, until the defects are fixed.
4. **Static pins** (SEL-022, RPL-011) check migration text, not live DB behaviour.
5. **Concurrency** (SEL-026) is asserted as a lock invariant, not a live race.

## Reproduce

```bash
export DATABASE_URL=mysql://app:app@127.0.0.1:3306/ci   # throwaway CI placeholder
pnpm qa                                                 # lint, typecheck, all suites, design check (expect exit 0)
pnpm --filter @rp/web exec vitest run src/server/ownership-transfers.test.ts src/server/claim-email.test.ts src/server/two-factor.test.ts src/server/seller-replies.test.ts
pnpm --filter @rp/core exec vitest run src/domain-policy.test.ts
# T-08: `pnpm infra:up && bash scripts/t08-minio-check.sh` on a host with Docker (also CI job t08-minio)
```

## History

- **task #59 (M3b-08):** FAIL. 30 of 48 P0 PASS, 17 PARTIAL, 1 FAIL. QA-M3B-01..05 opened.
- **task #62 (M3b-10):** QA-M3B-02 fixed in config. T-08 runtime still NOT RUN.
- **task #63 (M3b-11, this report):** 17 PARTIAL cases re-tested: 10 now PASS, 3 FAIL (new defects QA-M3B-06..08 confirmed), 4 NOT RUN (SEL-022, SEL-026, SEL-034 signed-out part, RPL-011: live-DB or route/E2E parts). QA-M3B-01, 03, 04, 05 closed. Verdict still FAIL.


- **task #64 (M3b-fix-01):** QA-M3B-06 (hourly per-account alert limit, `it.fails` now plain `it`), QA-M3B-07 (worker consumer mints/mails/reminds transfer cancel links, hash only) and QA-M3B-08 (MX enforced in the verification-egress group, no_mx -> REJECTED by RULE) closed. AUT-022, SEL-023, SEL-035 re-test PASS; verdict to be re-issued by the next gate run.