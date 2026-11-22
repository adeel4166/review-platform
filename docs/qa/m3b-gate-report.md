# M3b QA gate report (task #59, M3b-08 / M3b-09)

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Branch** | `task/59` (HEAD at start: `c610ae9`) |
| **Scope** | M3b: every P0 case in [m3b-spec.md §10](../architecture/m3b-spec.md#10-test-cases-for-qa), regression pins for T-01..T-05 and T-10, the 2FA bypass sweep, transfer-abuse cases, the business-email domain corpus, the seller-reply cross-seller matrix and the link/contact corpus, and the T-08 SEC-07 runtime check on MinIO |
| **Catalogue** | [test-case-catalogue.md](./test-case-catalogue.md) |
| **Predecessor** | [m3-gate-report.md](./m3-gate-report.md) (M3a, task #50) |

## Verdict

**FAIL. The M3b gate does not pass.** The acceptance rule is "zero open P0 defects" and "all P0 cases in §10 green". Four things block it:

1. **Two P0 defects are open** (QA-M3B-01, QA-M3B-02). One is a missing mail header (SEL-036). The other is a missing 24 h lifecycle rule on the ingest bucket (T-08).
2. **T-08 was not run.** The sandbox has no Docker and nothing listens on `127.0.0.1:9000`. Starting MinIO is a long-running server, and the QA role does not allow that. The runbook is in §5. The static config review in §5.2 already shows the lifecycle rule is missing.
3. **17 of 48 P0 cases are only partly evidenced, and one fails.** The named tests cover the main behaviour, but a specific sub-assertion in the case has no test (for example, the SEL-022 raw-SQL CHECK test, or the reminder that invalidates an earlier cancel link). Under this report's rule a case is PASS only when a named test asserts the whole case.
4. **E2E was not run.** The Playwright specs (`two-factor.spec.ts`, `ownership-transfer.spec.ts`, `seller-reply.spec.ts`) need MySQL, Redis, MinIO and a built app. They run in CI.

What passed: the unit and integration suites (1,012 tests), typecheck, the T-02/T-03/T-04/T-05/T-10 regression pins, and 30 of 48 P0 cases. The rest of the report gives the detail.

## 1. Evidence (this run)

| Layer | Command | Result |
|---|---|---|
| Unit and integration | `DATABASE_URL=<ci placeholder> pnpm -r --no-bail test` | **pass**: core 362, worker 152, web 498 (1,012 tests, 54 files, 0 failures) |
| Coverage | `pnpm coverage` | see §1.1 |
| Typecheck | `pnpm typecheck` | **pass** (all packages) |
| Lint | `pnpm lint` | **FAIL**, exit 1: 4 `no-undef` errors in `scripts/preview-smoke.mjs` (`fetch`, `URL`, `Headers`). Not M3b code (QA-M3B-03) |
| E2E (Playwright) | `pnpm --filter @rp/web test:e2e` | **not run here**. Needs CI services |
| T-08 MinIO runtime | §5 | **not run here** (no Docker, MinIO not listening) |

`DATABASE_URL` is set to the throwaway CI placeholder, because `prisma validate` needs it. No real secret was read or printed.

### 1.1 Coverage (statements / branches / functions / lines)

| Package | Test files | Tests | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|---|---|
| `@rp/core` | 12 | 362 | 85.45 | 86.09 | 79.19 | 85.45 |
| `@rp/worker` | 12 | 152 | 73.49 | 79.72 | 75.00 | 73.49 |
| `@rp/web` | 30 | 498 | 88.43 | 80.98 | 88.60 | 88.43 |

Coverage is line-based and does not show whether a case is asserted. The per-case table below is the real gate.

## 2. Per-case results (P0)

Result key:
- **PASS**: a named test (suite and title below) asserts the whole case.
- **PARTIAL**: the main behaviour is tested, but a stated sub-assertion has no test. Counts as open for the gate.
- **FAIL**: a defect (see §4).
- **NOT RUN**: needs E2E or T-08.

Tests are cited by title, and the title carries the case ID where one exists. Untagged evidence is cited by file and title.

### 2.1 Existing cases implemented by M3b (spec §10.1)

| ID | Pri | Result | Evidence and gap |
|---|---|---|---|
| AUT-003 | P0 | **PASS** | `apps/web/src/server/two-factor.test.ts`: "5 failures kill the pending session", "per-account cap across sessions" |
| AUT-004 | P0 | **PASS** | `two-factor.test.ts`: "rejects a replayed code (AUT-004)", concurrent submissions |
| AUT-005 | P0 | **PASS** | `two-factor.test.ts`: "is not enabled until a valid code confirms it; ... never in audit rows" |
| AUT-006 | P0 | **PASS** | `two-factor.test.ts`: recovery codes "are stored hashed, single use". The ≥ 50-bit entropy is not asserted separately |
| AUT-011 | P0 | **PASS** | `two-factor.test.ts`: "confirm revokes other sessions and rotates the caller (AUT-011)" |
| AUT-013 | P0 | **PARTIAL** | No test file carries the AUT-013 tag, so the canary assertion (TOTP code, secret, recovery code and token never logged) is not confirmed by a named test. A tag exists only in a non-test source file. Needs a test |
| AZ-008 | P0 | **PASS** | `two-factor-gate.test.ts`; `ownership-transfers.test.ts`: "rejects an OWNER without 2FA-verified session (TWO_FACTOR_REQUIRED)" |
| AZ-009 | P0 | **PASS** | `two-factor-gate.test.ts`: "only the two 2FA endpoints import requirePendingSession" |
| AZ-010 (reply clause, RPL-002) | P0 | **PASS** | `apps/web/src/server/seller-replies.test.ts`: "cross-seller authz on create, table-driven" |
| SEL-006 | P0 | **PASS** | `apps/web/src/server/ownership-transfers.test.ts` (14 cases, see §2.3) |
| E2E-009 | - | **NOT RUN** | `two-factor.spec.ts` (3 tests). Needs services. No priority in the spec table |
| A11Y-002, A11Y-006 | - | **NOT RUN** | No unit or E2E test names these IDs. No priority in the spec table |

### 2.2 2FA and sessions (spec §10.2)

| ID | Pri | Result | Evidence and gap |
|---|---|---|---|
| AUT-018 | P0 | **PASS** | `two-factor.test.ts`: "accepts a valid code, rotates the pending session" (AUT-018); "rotated sessions can be claimed once, within 60 s, by the same user only" |
| AUT-019 | P0 | **PASS** | Tagged test, `two-factor-jwt.test.ts` (2 tagged tests) |
| AUT-020 | P0 | **PASS** | Tagged test (AAD on TOTP ciphertext, old `keyId` still verifies) |
| AUT-021 | P0 | **PASS** | `two-factor.test.ts`: "pending secret expires after 15 minutes; a replacement keeps the old secret working until confirmed" |
| AUT-022 | P0 | **PARTIAL** | Shared per-session counter for recovery codes and TOTP is tested ("share the per-session failure counter with TOTP"). **No test asserts the hourly `SECOND_FACTOR_FAILURES` alert** (grep: zero hits) |
| AUT-023 | P0 | **PASS** | Tagged twice. Staff recovery: "TOTP row and unused codes removed, other sessions revoked, security-channel event" |
| AUT-024 | P0 | **PASS** | Tagged test; "disable: step-up required, staff refused with 409, others revoked" |
| AUT-025 | P0 | **PASS** | "the window is 10 minutes (9:59 ok, 10:01 STEP_UP_REQUIRED)" |
| AUT-026 | P0 | **PASS** | Tagged test (revocation on next request) |
| AUT-028 | P0 | **PASS** | `two-factor.test.ts` (limiter rejects, asserts `status: 503`, and that the code is not evaluated) |
| AUT-029 | P0 | **PASS** | `apps/worker/src/groups.test.ts`: `it.each` over `TOTP_ENC_KEYS`, `TOTP_ENC_ACTIVE_KEY_ID`, `RECOVERY_CODE_PEPPERS`, `RECOVERY_CODE_ACTIVE_KEY_ID`, `AUTH_SECRET`. Entrypoint exits non-zero |
| AZ-026 | P0 | **PASS** | Tagged test (seller guard matrix) |
| AZ-027 | P0 | **PASS** | `two-factor-gate.test.ts`: "every /api/admin route handler is gated by requireAdmin or requireSuperAdmin" and "discovers the route registry (guards against an empty sweep)". See §3 for the seller-route gap |
| AUT-027 | P1 | **PASS** | Tagged test (lifetimes) |
| AZ-028 | P1 | **not evidenced** | `grantStaffRole` (`apps/web/src/server/staff-roles.ts:33`) has the T-06 guard in code, but **no test imports it** (QA-M3B-04) |

### 2.3 Ownership changes (spec §10.3)

Evidence for every row is `apps/web/src/server/ownership-transfers.test.ts`, unless noted.

| ID | Pri | Result | Evidence and gap |
|---|---|---|---|
| SEL-020 | P0 | **PARTIAL** | `invalid_transition` is tested, but no full status × action matrix is named. The outcome CHECKs are static only |
| SEL-021 | P0 | **PARTIAL** | Passes: OWNER + 2FA + step-up required; target must be 2FA-enrolled; "one open change per seller". Gap: the spec's `ownership_change_pending` string is **not found in code** (grep zero). Behaviour may be covered under another code. MANAGER → `FORBIDDEN_ROLE` is not named in a title |
| SEL-022 | P0 | **PARTIAL** | Passes: "accepting early only records acceptance; no role change before 72 h even if the executor runs early"; "completes after 72 h". Gap: the raw-SQL insert rejected by `chk_transfer_delay` is **static only** (migration and Prisma), not run against MySQL |
| SEL-023 | P0 | **PARTIAL** | Passes: a cancel-token row per OWNER and target. Gap: "only hashes stored" and "reminder at T − 24 h invalidates the earlier link" have no test |
| SEL-024 | P0 | **PARTIAL** | Passes: "cancel link: works once without a session, replays and garbage give the same 400". Gap: "another transfer's token cannot cancel this one" is not asserted |
| SEL-025 | P0 | **PARTIAL** | Passes: `TWO_FACTOR_MISSING` at execution and `INITIATOR_NOT_OWNER`. Gap: seller suspended at execution and target banned at execution have no test |
| SEL-026 | P0 | **PARTIAL** | Gap: no concurrency test (TRANSFER + REMOVED racing a co-owner's leave). Only the unit property "planOwnershipChange never leaves a seller without an OWNER" |
| SEL-027 | P0 | **PASS** | "an OWNER cannot remove another OWNER directly (use_ownership_change)"; "REMOVE_OWNER needs no acceptance, waits 72 h"; the target can cancel |
| SEL-028 | P0 | **PARTIAL** | Passes: target removal cancels the open change (T8). Gap: initiator membership change, and "invitations still cannot grant OWNER" |
| SEL-029 | P0 | **PARTIAL** | Passes: "only an OWNER of THIS seller may start one; non-members get 404". Gap: cross-seller accept and cancel of B's change, and `sellerId` in the body → 400 |
| SEL-030 | P1 | **PASS** | "staff cancel needs ADMIN, a reason, and not being a member (CONFLICT_OF_INTEREST)" |

### 2.4 Business-email claims (spec §10.4)

| ID | Pri | Result | Evidence and gap |
|---|---|---|---|
| SEL-031 | P0 | **PARTIAL** | `packages/core/src/domain-policy.test.ts`: "refuses a subdomain mailbox, a bare suffix and a mismatching claimed domain"; "accepts a personal address and flags role addresses". Gap: quoted local part, comment, IP literal, non-ASCII local and local > 64 are not named. The corpus entries are untitled (`it(".")`) and were not checked line by line |
| SEL-032 | P0 | **PASS** | `domain-policy.test.ts`: corpus includes `github.io`, `myshopify`, `blogspot`, `amazonaws`, `pages.dev`; "applies wildcard and exception rules"; "registrable domains under newer multi-label suffixes are accepted" |
| SEL-033 | P0 | **PARTIAL** | `claim-email.test.ts`: "a role address needs human review"; "a role-address claim passes the check but stays PENDING". Gap: reserved local parts; "token used → C4 queue, never VERIFIED by RULE" |
| SEL-034 | P0 | **PARTIAL** | `claim-email.test.ts`: "replay by ANOTHER user ... fails uniformly and does not consume the token". Gap: signed-out → 401, pending 2FA → 401, claimant demoted → 403 |
| SEL-035 | P0 | **PARTIAL** | `domain-policy.test.ts`: "requires an MX record". Gap: no test that the core resolver is never called outside the egress group; no test for DNS error → back-off → EXPIRED |
| SEL-036 | P0 | **FAIL** | Token hashed at rest and fragment link are tested ("never stores a token hash at registration"; "invalidates open tokens"). **The `Auto-Submitted` header is absent from the code.** Case not met (QA-M3B-01) |
| SEL-037 | P1 | **PASS** | "rejects the claim without sign-in, flags the seller, and cannot be used afterwards" |
| SEL-038 | P1 | **PARTIAL** | Per-user and per-domain limits are tested. Gap: "one open claim per address" |
| SEL-039 | P1 | **not evidenced** | No test for renewal by email token or `VALIDITY_ENDED` with a fake clock |

### 2.5 Seller replies (spec §10.5)

| ID | Pri | Result | Evidence and gap |
|---|---|---|---|
| RPL-001 | P0 | **PASS** | `packages/core/src/reply-policy.test.ts`: corpus covers bidi, zero-width, tag characters, fullwidth dots, `[.]`, markdown, entities, phone (soft flag), messenger (soft flag). Also `apps/web/src/server/seller-replies.test.ts` "content policy on create and edit (RPL-001)" |
| RPL-002 | P0 | **PASS** | `seller-replies.test.ts`: "cross-seller authz on create, table-driven (RPL-002, P-2)": every role of A on a review of B → 404; body `sellerId` rejected |
| RPL-003 | P0 | **PARTIAL** | "seller ${status} → ${expected}" table and "an active SELLER_SUSPENSION denies with SELLER_SUSPENDED". Gap: the grace row (in grace → allowed) is not visible in any title |
| RPL-004 | P0 | **PASS** | "SELLER_REPLY_RESTRICTION (RPL-004)": blocks create and edit, not delete; expiry restores; issuer COI refused |
| RPL-005 | P0 | **PASS** | `apps/worker/src/seller-reply-moderation.test.ts` (tagged RPL-005): case created with outbox; stale-version decision does not publish |
| RPL-006 | P0 | **PARTIAL** | Unit rendering rule passes ("shown only when PUBLISHED, sellerId = product.sellerId and the seller is VERIFIED"). The DOM check (`<a href>` and `javascript:` render as text) is **E2E, not run** (`seller-reply.spec.ts`) |
| RPL-007 | P0 | **PASS** | "editing a PUBLISHED reply makes it non-public (PENDING, version + 1)"; "REMOVED cannot be edited or deleted"; "a reply after DELETED reuses the row with version + 1" |
| RPL-009 | P0 | **PASS** | Tagged test: "OWNER/MANAGER without a verified 2FA session are denied; RESPONDER is not" |
| RPL-011 | P0 | **PARTIAL** | `chk_case_subject` exists in `packages/db/prisma/migrations/20261213000000_seller_replies/migration.sql` (static). Gap: "deleting a review that has cases is refused (Restrict)" is not tested |
| RPL-008 | P1 | **PASS** | Rate limit hook ordering and per-reply edit limit are tested |
| RPL-010 | P1 | **not evidenced** | No test: author replying to own review; review not PUBLISHED → 409 |
| RPL-012 | P1 | **PASS** | "DTO has no author"; "audits without the body" |
| RPL-013 | P1 | **PASS** | `sellers.test.ts`: "T-04: a staff actor who is a member of the seller cannot suspend or unsuspend it (CONFLICT_OF_INTEREST)" |

### 2.6 Summary of P0 results

| Section | P0 cases | PASS | PARTIAL | FAIL |
|---|---|---|---|---|
| §10.1 existing | 10 | 9 | 1 (AUT-013) | 0 |
| §10.2 2FA and sessions | 13 | 12 | 1 (AUT-022) | 0 |
| §10.3 ownership changes | 10 | 2 | 8 | 0 |
| §10.4 business-email claims | 6 | 1 | 4 | 1 (SEL-036) |
| §10.5 seller replies | 9 | 6 | 3 | 0 |
| **Total** | **48** | **30** | **17** | **1** |

E2E and T-08 cases are outside this count. E2E-009, A11Y-002 and A11Y-006 are not counted because the spec gives them no priority.

## 3. Regression, bypass and corpus checks (requested scope)

| Item | Result | Evidence |
|---|---|---|
| T-01 verification-egress startup assertion | **PASS** | `apps/worker/src/groups.test.ts`: `it.each` over five secret names; entrypoint exits non-zero when `DATABASE_URL` present |
| T-02 pre-hijacking | **PASS** | `apps/web/src/server/t02-prehijack.test.ts`: attacker registers victim email; old password and old session fail |
| T-03 www-only META token | **PASS** | `apps/worker/src/verification/checks.test.ts`: "META: fetches only the apex (T-03, no www fallback)"; "a claim whose token is served only on www stays PENDING" |
| T-04 COI on seller suspend / unsuspend | **PASS** | `sellers.test.ts`: T-04 CONFLICT_OF_INTEREST; "unsuspend by the issuing admin → second_actor_required" |
| T-05 staff-approve re-checks | **PASS** | `claims.test.ts`: "STAFF_APPROVE re-checks (T-05)": rejects when seller not live, claimant removed or demoted, auto-method evidence older than 24 h |
| T-10 full PSL snapshot | **PASS** | `domain-policy.test.ts`: "is a real, versioned snapshot"; SEL-032 corpus |
| 2FA bypass attempts, admin routes | **PASS** | `two-factor-gate.test.ts`: every `/api/admin` route gated; pending session reaches only the 2FA endpoints |
| 2FA bypass attempts, seller routes | **PARTIAL** | AZ-026 unit matrix, `ownership-transfers.test.ts`. No registry sweep for `/api/sellers/*` routes. Gap |
| Transfer abuse: missing 2FA | **PASS** | `ownership-transfers.test.ts`: target without 2FA refused; OWNER without 2FA refused |
| Transfer abuse: early completion | **PASS** | "accepting early only records acceptance; no role change before 72 h even if the executor runs early" |
| Transfer abuse: last OWNER | **PASS** | "planOwnershipChange never leaves a seller without an OWNER"; "the last OWNER cannot leave" |
| Business-email domain corpus | **PARTIAL** | PSL corpus PASS (SEL-032). Address-parser corpus PARTIAL (SEL-031) |
| Seller-reply cross-seller matrix | **PASS** | RPL-002 table-driven, every role |
| Seller-reply link and contact corpus | **PASS** | RPL-001, `reply-policy.test.ts` |

## 4. Defects

I have no access to the ticket tracker from this sandbox, so none of these are filed yet. Each entry is a bug report for the platform to file. The M3 gate report took the same approach.

| ID | Pri | Area | Summary | Evidence | Blocks gate |
|---|---|---|---|---|---|
| **QA-M3B-01** | **P0** | SEL-036, M3b-06 claim mail | Outbound business-email claim token mail does not carry `Auto-Submitted`. The spec requires it. | Case-insensitive grep for `auto.?submitted` over `apps`, `packages`, `scripts`, `infra` (excluding build output) returns zero hits | **Yes** |
| **QA-M3B-02** | **P0** | T-08 / SEC-07(3) | The ingest bucket has no 24 h lifecycle rule. | `docker-compose.yml` `minio-init` runs `mc mb` and `mc anonymous set download` on `rp-public`. No `mc ilm` command anywhere. No lifecycle code in `apps`, `packages` or `infra` | **Yes** (static evidence; confirm at runtime, §5) |
| QA-M3B-03 | P1 | Tooling, `pnpm lint` | `pnpm lint` fails with 4 `no-undef` errors in `scripts/preview-smoke.mjs` (`fetch`, `URL`, `Headers`). Introduced by task/60, not M3b. Breaks `pnpm qa` | `/tmp` lint run, exit 1 | No (but fix before merge) |
| QA-M3B-04 | P1 | AZ-028, T-06 | `grantStaffRole` (`staff-roles.ts:33`) has the T-06 guards in code but no test imports it | grep for `grantStaffRole` in `*.test.ts` returns zero | No (P1 case) |
| QA-M3B-05 | P1 | SEL-021 | Spec error code `ownership_change_pending` not found in code. Behaviour may use another code. Check against §7 | Exact-string grep returns zero | No. Needs confirmation |

**Test-coverage gaps** are the 17 PARTIAL P0 cases in §2. They are not product defects, but they keep the P0 set from being green. Write the missing assertions before the gate is re-run. The gaps are in: AUT-013 (canary), AUT-022 (alert), SEL-020, SEL-021 (code), SEL-022 (live CHECK), SEL-023, SEL-024, SEL-025, SEL-026 (concurrency), SEL-028, SEL-029, SEL-031, SEL-033, SEL-034, SEL-035, RPL-003 (grace), RPL-006 (E2E), RPL-011 (Restrict).

## 5. T-08: SEC-07 runtime check on MinIO

**Status: NOT RUN.** The check needs a running MinIO, and the QA sandbox has no Docker. Nothing listens on `127.0.0.1:9000` (HTTP 000 at the time of the run). Starting `pnpm infra:up` would start a long-running server, which is outside the QA role's permissions.

### 5.1 What the unit suite already shows (not a runtime result)

| Check | Evidence |
|---|---|
| Presigned PUT signs `content-length` | `packages/core/src/media-presign.test.ts` (SEC-013): changing the declared size changes the signature. Recorded in [m2-hardening-gate-report.md](./m2-hardening-gate-report.md) |
| `content-type` is not signed | Open Low finding from the M2 review. The test deliberately does not assert it. The worker sniffs magic bytes and re-encodes |

### 5.2 Static config review (MinIO bucket setup)

`docker-compose.yml`, `minio-init`:
- Creates `rp-ingest`, `rp-private`, `rp-public`.
- Sets `rp-public` to anonymous download. That is intended.
- **No `mc ilm rule add` on `rp-ingest`.** So no 24 h expiry. QA-M3B-02.
- **No CORS configuration** anywhere in the repo for the ingest bucket. Whether the bucket has CORS applied outside the repo cannot be checked without MinIO. QA-M3B-02 covers the lifecycle; CORS is listed under §5.4 as unverified.

### 5.3 Runbook (for a reviewer with Docker, or against R2)

Run from the repo root on a host with Docker. Use only the local compose MinIO, never a production bucket.

```bash
pnpm infra:up                      # MinIO + minio-init (creates buckets)
# 1. Signed content-length
#    Presign a PUT with contentLength=N (packages/core media presign), then:
curl -s -o /dev/null -w "%{http_code}\n" -X PUT --data-binary @<N+1 bytes> "<presigned-url>"   # expect 403 SignatureDoesNotMatch
curl -s -o /dev/null -w "%{http_code}\n" -X PUT --data-binary @<N bytes>   "<presigned-url>"   # expect 200
# 2. PUT after confirm: confirm the upload, then PUT different bytes to the same URL.
#    Record the result. The M2 review notes the URL stays valid after confirm (bounded TOCTOU).
# 3. Bucket CORS: preflight against the ingest bucket
curl -s -D - -o /dev/null -X OPTIONS -H "Origin: https://app.example" \
  -H "Access-Control-Request-Method: PUT" "http://127.0.0.1:9000/rp-ingest/<key>"
#    Expect Access-Control-Allow-Origin only for the app origin, and no wildcard.
# 4. 24 h lifecycle
mc ilm rule ls local/rp-ingest     # expect one rule, expiry 1 day on the ingest prefix
```

Pass criteria: (1) N+1 bytes rejected; (2) N bytes accepted; (3) the CORS response allows only the app origin; (4) a 1-day expiry rule exists on `rp-ingest`. For (2), record the observed result and flag it if overwrite succeeds without worker re-verification. Repeat against R2 before launch, as the M3 review asks.

### 5.4 Result

| Sub-check | Result | Note |
|---|---|---|
| Signed content-length (runtime) | **NOT RUN** | Unit evidence only (§5.1) |
| PUT after confirm | **NOT RUN** | Known open TOCTOU, bounded (M2 review) |
| Bucket CORS | **NOT RUN, unverified** | No CORS in repo config. Needs runtime or console check |
| 24 h lifecycle | **FAIL (static)** | Not in `minio-init`. QA-M3B-02 |

**Update (task #62):** QA-M3B-02 is fixed in config: `minio-init` adds a 1-day expiry rule on `rp-ingest` (idempotent) and the `minio` service sets `MINIO_API_CORS_ALLOW_ORIGIN` to `APP_URL` (default `http://localhost:3000`, no wildcard). R2 settings: [ingest-bucket-hardening.md](../security/ingest-bucket-hardening.md). The runbook is scripted as `scripts/t08-minio-check.sh` and runs in CI job `t08-minio`. **Runtime results are still NOT RUN:** the DevOps sandbox has no Docker, so no MinIO was started. Record the CI/host output here once run.

T-08 is therefore **not closed**. The gate cannot pass until the runtime check runs and QA-M3B-02 is fixed.

## 6. Gaps and risks

1. **E2E is not run here.** Seller, two-factor, ownership-transfer and seller-reply Playwright specs need the CI services. The CI `e2e` job must pass before the gate can be signed off.
2. **Several P0 cases rely on static checks.** The DB CHECKs for transfers (SEL-022, `chk_transfer_delay`), reply subject (RPL-011) and TOTP (AUT-020) are asserted from migration text or in the unit layer. They are not executed against MySQL 8.
3. **Assertions are not counted as tests.** A PASS here means a named test asserts the case. Test titles were checked; test bodies were not all read line by line. The PARTIAL cases are the ones most likely to change once the bodies are read.
4. **The `content-type` signing decision is open.** This is the M2 Low finding. It is a decision for security, not a defect.
5. **Lint fails on a non-M3b script** (QA-M3B-03). It should be fixed before `pnpm qa` is used as the merge check.

## Reproduce

```bash
export DATABASE_URL=mysql://app:app@127.0.0.1:3306/ci   # throwaway CI placeholder
pnpm -r --no-bail test                                  # expect core 362, worker 152, web 498
pnpm typecheck
pnpm lint                                               # currently fails: QA-M3B-03
pnpm coverage
pnpm --filter @rp/web exec vitest run src/server/two-factor-gate.test.ts src/server/ownership-transfers.test.ts src/server/seller-replies.test.ts
pnpm --filter @rp/worker exec vitest run src/groups.test.ts src/verification/checks.test.ts
pnpm --filter @rp/core exec vitest run src/domain-policy.test.ts src/reply-policy.test.ts
# T-08: `pnpm infra:up && bash scripts/t08-minio-check.sh` on a host with Docker (also CI job t08-minio).
```
