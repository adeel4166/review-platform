# Final security review: CLOSE-01/02 and M8 (task #87, SEC-FINAL)

| | |
|---|---|
| **Owner** | Security Engineer (QA_SECURITY) |
| **Branch** | `task/87` (reviewed tree = `main` at `3725d5e`, merge of task #86) |
| **Scope** | Closure of SEC-M5-01..03, SEC-M6-01..11, SEC-M7-01..04 from [m5-m7-security-review.md](./m5-m7-security-review.md); M8 retention, erasure, deletion ledger, key rotation, audit export; CI and production config. Threats P-3..P-9, D-4, D-5, R-7, R-9 ([threat-model.md](./threat-model.md)) |
| **Method** | Static review of the code cited per finding. **Nothing was executed**: no MySQL, Redis, MinIO, ClamAV, Docker or real AI provider is available in this sandbox, so "closed" below means "the code path is present and correct on reading", not "observed running". No secret or `.env` was read; variable NAMES only. `pnpm audit` and the secret grep were **not** re-run in this task; CI enforces both and they must be re-run on the release commit. |
| **Companion** | [pentest-scope-pack.md](./pentest-scope-pack.md) (OPS-005 vendor hand-off) |

## 1. Decision

**Result: CONDITIONAL PASS. Zero open P0. Three open P1, each with explicit CEO-facing text in section 5.**
Every P0 and P1 from the M5 to M7 review is verified closed in code (section 2). The M8 work introduces no exploitable flaw I could find, but it
leaves three launch-readiness gaps. All are **fail-closed** (the system refuses to run, or a purge job errors, rather than running unsafely), so they are
availability and privacy-promise problems, not exposure problems.

| Level | Meaning |
|---|---|
| P0 | Exploitable now, or a launch-gating control is absent or bypassable with serious impact. |
| P1 | A required control is missing, weak or not wired. Fix before real-user onboarding, or the CEO accepts the stated risk in writing. |
| P2 | Hardening or bounded abuse. Schedule. |

## 2. Closure verification of the earlier findings

| ID | Was | Status on `main` | Evidence (current tree) |
|---|---|---|---|
| SEC-M6-01 | P0 | **Closed** | Route calls `requestRoleGrant` (`apps/web/src/app/api/admin/staff/[id]/roles/route.ts`); `grantStaffRole` is gone and `staff-roles.ts` only revokes; the only `userRole.upsert` is `grant()` in `approvals.ts`, reached by the MODERATOR single-actor path or `approveRequest`. ADMIN / SUPER_ADMIN / SENIOR_MODERATOR need a second SUPER_ADMIN (`APPROVER_ROLES.ROLE_GRANT`), self-approval is `approval_self`, role enum and target eligibility (ACTIVE, verified, confirmed 2FA) are re-checked before execution (`approvals.ts:114`) |
| SEC-M6-02 | P0 | **Closed in code; see SEC-FIN-01** | `createModerationProvider` refuses mock/unset in production (`moderation-provider.ts:65`), worker boot refuses (`core-main.ts:30`), the moderation queue runs `processAssessJob` -> `runAssess` (`processors.ts:69`), provider errors throw and dead-letter to a human. Fail closed |
| SEC-M6-03 | P1 | **Closed** | `break-glass.ts:11-19`: row read through `purchaseProofFile`, `proofId` binding and `isRedacted` checked, 404 instead of a fallback record, key built only from a DB-verified id matching `SAFE_ID`, purged original returns 410 |
| SEC-M6-04 | P1 | **Closed** | `approvals.ts:131` emits `TWO_FACTOR_RESET`; copy added in `email.ts` by task #83 |
| SEC-M6-05 | P1 | **Closed (residual accepted)** | Staff targets need a SUPER_ADMIN requester (`approvals.ts:83` path) and approver (`approvals.ts:115`). Residual: two colluding SUPER_ADMINs can still reset a third; that is the shared trust assumption of every four-eyes control and is in the pen-test focus list |
| SEC-M5-01 | P1 | **Closed (residual P2, SEC-FIN-10)** | ffmpeg/ffprobe run through `bwrapArgv` (`--unshare-all --die-with-parent --cap-drop ALL` plus prlimit as/cpu/fsize/nofile, `media/sandbox.ts:51-61`); both have `-protocol_whitelist file` and a forced demuxer (`media/video.ts:23,57,72`); startup self-test exits 1 if the sandbox cannot be proven (`core-main.ts:37`, `MEDIA_SANDBOX_REQUIRED`) |
| SEC-M7-01 | P1 | **Closed** | `core-main.ts:124-143` schedules vote-freeze, product-burst and nightly decay; the assess job receives the DB-backed burst and near-duplicate ports; `notification.requested` and `security.alert` have consumers (`processors.ts`). `scanStaffAnomalies` is still not scheduled: SEC-FIN-06 |
| SEC-M6-06 | P2 | **Closed** | Execution-time re-checks run before the conditional claim (`approvals.ts:112-115`) |
| SEC-M6-07 | P2 | **Closed** | `loadAppellant` reads `trustBand` from the DB (`appeals.ts:14-16`, used in `appeals/route.ts`) |
| SEC-M6-08 | P2 | **Closed** | `staffOf` rejects a missing `sid` (`m6-routes.ts:15-17`); `security.alert` job has a real sink plus optional mail |
| SEC-M6-09 | P2 | **Closed** | `roleFrom` returns `senior_moderator` / `moderator` (`auth.ts:23-24`), mapped in `STAFF_ROLES` (`m6-routes.ts:9-12`). Per-route least privilege is a pen-test item |
| SEC-M6-10 | P2 | **Open** (SEC-FIN-07) | `instructionLike` is computed in `assess.ts:19` and consumed nowhere |
| SEC-M7-02 | P2 | **Closed** | `NEW_FOLLOWER` e-mail grouped per recipient and day (`notifications/dispatch.ts:16-18`) |
| SEC-M7-03 | P2 | **Closed** | 24 h thresholds (40, low-trust 15) in `trust/burst.ts:3`; near-duplicate index is DB backed |
| SEC-M7-04 | P2 | **Closed** | Trust band now moves through the wired recompute; the `perIpDay` / `ipHash` residual is acceptable (24 h window vs 90 d nulling) |
| SEC-M5-02 | P2 | **Closed** | AV scan and signature freshness check before a proof original is stored (`proofs.ts:81-85`); `limitInputPixels` on the redactor (`proofs.ts:46`) |
| SEC-M5-03 | P2 | **Closed** | `sweepQuarantine` daily with a count alert (`core-main.ts`, `media/quarantine.ts`) |

## 3. Threat-by-threat review

| Threat | Control found | Verdict |
|---|---|---|
| **P-3** privilege escalation | One route, SUPER_ADMIN + step-up, four-eyes for the non-MODERATOR roles, no self-grant, target eligibility re-checked in the executing transaction, sessions revoked on grant and revoke, floor of 2 SUPER_ADMINs serialised with `FOR UPDATE` (`staff-roles.ts`). The threat model's "alert on every grant to a channel outside the app" is not implemented | Closed; P2 gap (SEC-FIN-06) |
| **P-4** coerced moderator | `scanStaffAnomalies` exists and is unit tested but nothing schedules it | **Open P2** (SEC-FIN-06) |
| **P-5** insider browsing | Per-staff daily cap, repeat-access approval, session-bound single-use 60 s access, hardened headers, audit before and after serve. An approved repeat request does nothing (SEC-FIN-05) | Closed for first access; P2 for repeats |
| **P-6** audit tampering | Export with read-back hash check to an object-locked bucket, delete only after verification, via a separate DB role. But the buckets, credentials and INSERT-only grant are **not provisioned anywhere in the repo** (the grant is a migration comment only), `RET-AUDIT` returns 0 silently when unconfigured, and the manifest is not chained across days | **Open** (SEC-FIN-02 P1, SEC-FIN-08 P2) |
| **P-7** config tampering | Four-eyes activation, validation before the request, checksum re-checked at approval, hard floors, audit of the version change | Closed |
| **P-8** staff-console XSS/CSRF | Nonce CSP in `middleware.ts`, step-up on privileged actions, escaped-text rendering. Needs runtime verification | Closed on reading; pen-test focus |
| **P-9** AI/RULE principal | AI output only feeds `transition()` through the verdict table; BAN and SUSPENSION are in human routes. No dedicated test that the AI actor cannot create them | Closed structurally; P2 test gap (SEC-FIN-09) |
| **D-4** expensive queries | Comparison cap and pagination limits from M7; not load tested here | Pen-test focus |
| **D-5** AI cost / outage | Breaker and daily cap in core `assess`; failure -> UNSURE -> human, never CLEAN. **No real provider exists, so none of this has run against a live service** | Closed in design; blocked by SEC-FIN-01 |
| **R-7** deletion not honoured | Delete, HEAD must be 404, ledger append, replay job, runbook. Gaps: ledger not provisioned in production (SEC-FIN-02), reader truncates at 10,000 objects (SEC-FIN-03), erased user rows not ledgered (SEC-FIN-04) | **Open** (2 P1, 1 P2) |
| **R-9** break-glass abuse | See P-5; `no-store`, no presigned URL, key never returned | Closed |

## 4. Findings table (new in this review)

| ID | Sev | Title | Where |
|---|---|---|---|
| SEC-FIN-01 | **P1** | No production-capable moderation provider exists; the production worker (correctly) refuses to start, and the live adapter maps one legacy score onto a single category | `packages/core/src/moderation-provider.ts:65-71`, `apps/worker/src/moderation/live.ts` (`liveProviderCall`) |
| SEC-FIN-02 | **P1** | Production compose does not provision the deletion ledger, audit archive or `ARCHIVE_DATABASE_URL`; in production the retention and erasure jobs throw | `docker-compose.prod.yml` (worker-core env, `minio-init` at line 80), `apps/worker/src/m8-jobs.ts:20-22,28,59,71` |
| SEC-FIN-03 | **P1** | Ledger reader lists at most 10,000 objects oldest-first, so after a restore the newest purges are not replayed | `packages/core/src/retention/ledger.ts:29`, `packages/core/src/media.ts:147-156` |
| SEC-FIN-04 | P2 | Account erasure is not ledgered: restoring an older dump resurrects the user row, and recovery relies on a manual "support record" | `apps/worker/src/account/erase.ts` (`eraseAccount`), `docs/ops/restore-runbook.md:20-21` |
| SEC-FIN-05 | P2 | Approved `BREAK_GLASS_REPEAT` executes nothing (no access row is created); fails closed but the control is a dead end | `apps/web/src/server/approvals.ts:133`, `break-glass.ts` (`needs_approval` branch) |
| SEC-FIN-06 | P2 | `scanStaffAnomalies` (P-4) has no scheduled caller; no out-of-app alert on role grants (P-3) | `apps/worker/src/maintenance/staff-anomaly.ts`, `approvals.ts:126` |
| SEC-FIN-07 | P2 | Prompt-injection hint `instructionLike` is computed and ignored (carry-over of SEC-M6-10) | `packages/core/src/moderation/assess.ts:19` |
| SEC-FIN-08 | P2 | Audit archive: manifest is unsigned and rewritten per run; `prevHash` copies the previous manifest's `prevHash` so days are not chained; the delete-capable archive DB credential lives in the core worker env; INSERT-only app grant not provisioned | `apps/worker/src/maintenance/audit-export.ts` (`archiveAuditRows`), `m8-jobs.ts:56-60` |
| SEC-FIN-09 | P2 | No test asserts that the AI/RULE actor cannot create BAN / SUSPENSION (P-9) | `packages/core/src/moderation/transitions.test.ts` |
| SEC-FIN-10 | P2 | Supply chain and isolation: `minio/minio:latest`, `minio/mc:latest`, GitHub Actions pinned by tag not SHA; `worker-media` runs `seccomp=unconfined` (needed for bwrap) and holds `DATABASE_URL` | `docker-compose.prod.yml:42,59`, `.github/workflows/ci.yml` |
| SEC-FIN-11 | P2 | `ORDER_REF_HMAC_KEYS` is absent from the production compose and env example, so order-reference hashing silently has no keys (`parseOrderRefKeys` returns `[]`) | `packages/core/src/proofs.ts:57-58`, `apps/worker/src/processors.ts` (`orderRefKeys`) |
| SEC-FIN-12 | P2 | Key-rotation runbook covers TOTP, recovery pepper and IP hash only; `AUTH_SECRET` and the order-reference keys have no drill | `docs/ops/key-rotation-runbook.md` |
| SEC-FIN-13 | Info | OPS-009 (live-provider injection corpus run) and OPS-005 (external pen test) cannot be closed by this review | n/a |

### Details of the P1 findings

**SEC-FIN-01.** `createModerationProvider` returns the mock for `mock` and throws for every other name ("No real provider is wired yet").
In production the only accepted value therefore throws at boot (`core-main.ts:30`). That is the right failure mode and proves SEC-M6-02 is closed, but the
production build cannot start, and the pen-test staging in spec section 24 (production build, "AI provider fake or a sandbox key") cannot run with
`NODE_ENV=production`. `liveProviderCall` also passes the delimited user message to a legacy `assess({body})` and places the score in the first category, so even a real
legacy provider would leave the zero-tolerance categories at 0. **Fix:** implement a scores-only provider that returns the strict `{scores}` object for every
category; register it in `createModerationProvider`; run the OPS-009 corpus; give staging a named sandbox provider with a spend cap.

**SEC-FIN-02.** `getLedger()` needs `S3_LEDGER_ACCESS_KEY_ID`, `S3_LEDGER_SECRET_ACCESS_KEY` and `S3_BUCKET_LEDGER` and throws in production when any is missing (`m8-jobs.ts:20-22`).
`retentionHandlers()` calls it on every run, so the whole `maintenance.retention` job (including the unrelated IP-hash, session and notification rules) and `account.erase`
fail every time. The compose file sets only `S3_BUCKET_LEDGER`; `minio-init` creates only `rp-ingest`, `rp-private`, `rp-public`; there is no `rp-ledger` or
`rp-audit-archive` bucket, no object lock, no write-only or read-only ledger users, and no `ARCHIVE_DATABASE_URL`. `RET-AUDIT` returns 0 without a log or alert when its
variables are missing, so P-6 stays silently off. **Fix:** create both buckets with object lock (`mc mb --with-lock`), add the ledger writer, ledger reader and archive users and policies, list
every variable in compose with `:?`, extend `scripts/prod-config-check.sh` for them, make `RET-AUDIT` raise a security alert when unconfigured in production, and add the INSERT-only
grant and the separate archive role to the database runbook with a verification query.

**SEC-FIN-03.** `createLedgerReader.read` calls `store.list(bucket, "", 10_000)`. S3 listing is lexicographic, so once more than 10,000 segments exist the newest days (the ones a restore
needs) are dropped before the `since` filter runs. **Fix:** list by the `YYYY-MM-DD/` prefix for each day from `since` to today, paginate without a cap, and fail the job if a listing is truncated.

## 5. CEO-facing risk position for every open P1

| ID | Recommendation | Text for the CEO to accept or reject |
|---|---|---|
| SEC-FIN-01 | **Do not accept. Fix before launch.** | "Without a real moderation provider the platform cannot start in production, and AI-first moderation has never run against live traffic or the injection test corpus. Launching by disabling the safety check is not an option: the code refuses, and removing the refusal would publish unreviewed content (the original SEC-M6-02 P0). Launch requires one provider integration and one recorded OPS-009 run." |
| SEC-FIN-02 | **Fix before launch** (infrastructure only). Only the audit-archive half may be accepted temporarily | "I accept that for the first 30 days the audit log is kept online in the database only, not archived to write-once storage, so an administrator with direct database access could alter audit rows during that time; DevOps verifies the INSERT-only database grant before go-live. I do **not** accept running without the deletion ledger, because user data deletion promises (proofs, accounts) depend on it." Signed: CEO, date. Owner and deadline: DevOps, 30 days |
| SEC-FIN-03 | **May accept for launch**, fix within 60 days | "I accept that if the database must be restored from backup, deletions of the newest data may not be re-applied automatically once more than 10,000 ledger files exist. Until fixed, the restore runbook gets an extra step: count the ledger files; if over 8,000, re-run deletions day by day by hand. At launch volumes this is expected to take months to reach." Signed: CEO, date. Owner: Backend, 60 days |

## 6. Other review results

**Key rotation (OPS-002, A-14, R-6).** `reencryptTotp` is sound: batches, AAD-bound seal, decrypt-verify before write, per-row failure isolation, refuses
`done` while any row uses another key, and reports `removableKeys`. Recovery codes are correctly treated as non-re-keyable; nothing reissues them, so an old pepper may live as long as
those codes (documented in the runbook). `AUTH_SECRET` and order-reference keys are not covered (SEC-FIN-12).

**Retention and erasure (RET-*, PRV-012).** Rules honour `legalHold`, require a verified HEAD 404 before marking a purge, and the erasure job is idempotent per step with `completedAt` set only
after verification. The request route needs step-up and a typed handle; sole-owner erasure is blocked; erased handle and e-mail become non-reversible placeholders. Gaps: SEC-FIN-02 and SEC-FIN-04.
An erased author's review text stays public as "Former user" by design (ADR-0033); the pen test should confirm no author identifier leaks in any DTO.

**CI.** Positives: gitleaks over full history, blocking `pnpm audit --prod --audit-level=high`, `permissions: contents: read`, a real MySQL integration job, `ops003` with a self-check, a production-compose static check
and a fail-closed worker start test. Gaps: unpinned actions and images (SEC-FIN-10); `ops003` scans only the web output because the worker runs from source; the e2e job uses `MODERATION_PROVIDER: mock`, acceptable only because it
is not `NODE_ENV=production`.

**Production config.** Positives: Redis ACL with a least-privilege egress user, no literal secrets (script-checked), `cap_drop: ALL`, `read_only`, `no-new-privileges`, MinIO CORS pinned to `APP_URL`, `rp-public` the only anonymous
bucket, media worker without AI, SMTP or auth secrets, fixed egress subnet with an iptables policy (applied on the host, not by compose). Gaps: SEC-FIN-02, -10, -11.

## 7. Launch gate checklist (Security)

- [ ] SEC-FIN-01 fixed (acceptance not recommended)
- [ ] SEC-FIN-02 fixed, or the partial acceptance in section 5 signed
- [ ] SEC-FIN-03 fixed, or acceptance signed
- [ ] OPS-009 live-provider corpus run recorded
- [ ] OPS-005 external pen test complete, zero open S1/S2, retest letter attached ([pack](./pentest-scope-pack.md))
- [ ] DevOps evidence: INSERT-only grant on `audit_logs` and `moderation_decisions`, egress policy applied, object lock on `rp-ledger` and `rp-audit-archive`
- [ ] Re-run `pnpm audit --prod`, gitleaks, `pnpm qa` and the CI integration job on the release commit

## 8. Closure of the P1 launch blockers (task #89, LIVE-01)

| ID | Status | Evidence (file:line) |
|---|---|---|
| SEC-FIN-01 | **Closed in code** (live-model OPS-009 run still open, see [ops-009-stub-run.md](./ops-009-stub-run.md)) | `packages/core/src/moderation-provider.ts:57` (`anthropicProviderCall`, key only in `x-api-key`), `:127-139` (`createModerationProvider` selects by `MODERATION_PROVIDER`, requires `MODERATION_API_KEY`, still refuses mock/unset in production); `apps/worker/src/moderation/live.ts:15` (all 13 categories, no single-score mapping), `:27` (daily cap next to the breaker); tests `packages/core/src/ai/live-provider.test.ts`, `apps/worker/src/live01.test.ts` |
| SEC-FIN-02 | **Closed in config** | `docker-compose.prod.yml:95` (object-locked `rp-ledger` + `rp-audit-archive`), `:145` (`ARCHIVE_DATABASE_URL:?`), ledger/audit users and `infra/minio/policies/rp-ledger-w.json`, `rp-ledger-r.json`, `rp-audit-w.json`; `.env.production.example` (names only); `scripts/prod-config-check.sh`; `apps/worker/src/m8-jobs.ts` (`RET-AUDIT` logs a `security.alert` when unconfigured in production); test `apps/worker/src/live01.test.ts` (compose section). The INSERT-only DB grant is still a DevOps step |
| SEC-FIN-03 | **Closed** | `packages/core/src/retention/ledger.ts:32` (`ledgerDays`), `:42` (`createLedgerReader`: per-day `YYYY-MM-DD/` prefix, paginated, throws `LedgerListingTruncatedError` at the ceiling `:26`); test `packages/core/src/retention/ledger.test.ts` |
| QA-M5-12 | **Closed** | `infra/cdn/media-headers.json` (nosniff, CSP sandbox) read by `apps/worker/src/media-publish.test.ts`; MED-028 sha256 + no-overwrite in `apps/worker/src/media/publish.ts:93` with tests in the same file |

Launch gate checklist items "SEC-FIN-01/02/03 fixed" can be ticked on this evidence; the live OPS-009 run, OPS-005 and DevOps evidence remain.

## 9. Security review of LIVE-01..LIVE-05 (task #94, LIVE-06)

| | |
|---|---|
| **Reviewed tree** | `task/94` at `ed44fca` (merge of task #93). Delta reviewed: `3725d5e..HEAD` |
| **Method** | Static reading plus the unit tests that run offline: `packages/core` `src/ai` (22 tests pass), `apps/worker` `live01.test.ts` + `seed-demo.test.ts` (31 pass), `scripts/staging-config-check.sh` (0 FAIL). A tracked-file grep for key patterns (`sk-ant-`, `AKIA`, PEM private keys, Slack tokens) found none. No `.env` was read; variable names only. **Not run:** Docker/staging, a live provider, the e2e suite, `pnpm audit`. "Closed" means correct on reading, not observed running |
| **Result** | **PASS with conditions. Zero open P0. Zero open P1.** SEC-FIN-01, -02 and -03 are Closed (table 9.1). Eight new P2 findings and one carry-over (table 9.3). The live-model OPS-009 run is still the one gate item nobody can close from a sandbox |

### 9.1 SEC-FIN-01..03 verdicts

| ID | Verdict | Evidence (file:line) |
|---|---|---|
| SEC-FIN-01 | **Closed** (live OPS-009 run remains an operational gate, SEC-FIN-13) | Real provider exists: `packages/core/src/moderation-provider.ts:57-76` (`anthropicProviderCall`). Selected by name, key required, mock/unset refused in production: `:127-141`. Worker boot check: `assertModerationProviderConfigured` `:147`, tested by `apps/worker/src/live01.test.ts` (exits 1 with mock and with no key). All 13 categories are asked for and validated strictly: `ai/provider.ts:6-13` (`.strict()`), `moderation/live.ts:15-22` (the single-score mapping now only applies to the offline mock) |
| SEC-FIN-02 | **Closed in config.** One DevOps verification remains (INSERT-only DB grant, see 9.4) | Buckets with object lock: `docker-compose.prod.yml:95`; `ARCHIVE_DATABASE_URL:?` `:145`; `S3_BUCKET_LEDGER:?` `:80,136`; least-privilege policies `infra/minio/policies/rp-ledger-w.json` (PutObject only), `rp-ledger-r.json` (Get + List), `rp-audit-w.json`; unconfigured `RET-AUDIT` now raises a `security.alert` `apps/worker/src/m8-jobs.ts:60`; checks in `scripts/prod-config-check.sh:31,34` and `live01.test.ts:58-73`. Staging reuses all of it: `docker-compose.staging.yml:126-136,236-244` |
| SEC-FIN-03 | **Closed** | `packages/core/src/retention/ledger.ts:26` (ceiling), `:32` (`ledgerDays`), `:42-55` (`createLedgerReader`: one `YYYY-MM-DD/` prefix per day, throws `LedgerListingTruncatedError` instead of dropping segments). The store's `list` paginates (`packages/core/src/media.ts:147-157`) and the per-day ceiling is 1,000,000. Test `retention/ledger.test.ts` |

### 9.2 Review checklist results

| Area | Verdict | Notes |
|---|---|---|
| Prompt injection | **Sound structure, one residual** | Pinned system prompt, content only inside JSON-escaped `content` (`ai/prompt.ts:4-14`); strict schema rejects an extra `verdict` key or prose (`ai/provider.ts:6-13`); fenced JSON is the only tolerated wrapper (`moderation-provider.ts:73-74`). The corpus `test/fixtures/moderation/injection-canaries.json` runs through the real adapter with a stub transport (`ai/live-provider.test.ts`, `ops-009-stub-run.md`). Residual: an obedient model that returns **valid all-zero scores** still yields CLEAN, and the injection hint is ignored (SEC-LIVE-04) |
| Data delimiting | Pass | User text never enters `system`; test asserts the canary is absent from it |
| Key handling | Pass | Key read from `MODERATION_API_KEY` only, placed only in the `x-api-key` header (`:61`); transport errors do not echo the cause (`:43`); errors name variables, never values (`:135`). Compose gives the key to `worker-core` only (`docker-compose.staging.yml:246`); the web and media workers do not get it. `staging-up.sh` never writes it to the env file (`:6`, `:68`) |
| Breaker, daily cap | Works, with weaknesses | `assess.ts:27` checks both before any call; see SEC-LIVE-05 and -06 |
| Fail closed | Pass | Timeout, network, 4xx, 5xx, 429, garbage envelope, empty content all end as `ProviderError` or `schema` -> UNSURE -> human (`moderation-provider.ts:65-72`, `assess.ts:36-38`); a missing category fails the schema; there is no path from failure to CLEAN (`assess.ts:14-15,33`) |
| Cost abuse | Mostly bounded | Review body capped at 10,000 characters (`apps/web/src/server/validation.ts:21`), output at 600 tokens (`moderation-provider.ts:62`), reviews rate limited per user/hour/day and per IP (`ratelimit.ts:54-60`), edits limited (`reviews/[id]/route.ts:16`), replies limited. Spend cap weaknesses: SEC-LIVE-06 |
| Demo seed in production | Pass, but deny-list (SEC-LIVE-02) | `seed-demo-guard.ts:11-16` refuses `NODE_ENV` or `APP_ENV` = production and requires `DEMO_PASSWORD` (>= 12 characters, no default). Guard runs before any DB access (`seed-demo.ts:14`). Password never printed (`seed-demo.ts:152` prints only the variable name) |
| Hardcoded credentials | Pass for LIVE code | No literals; `staging-config-check.sh` greps compose for literal secrets and for echoes of secret variables. Legacy `seed.ts` is the exception (SEC-LIVE-03) |
| UI v2: server checks | Pass | The delta touches no API route and no auth code; the only server file changed is a one-line `ratingHistogram` select (`apps/web/src/server/products.ts`). Admin/seller pages keep their server-side `auth()` + redirect; the new `SellerPicker` only renders data the page already filtered. The two client `fetch("/api/auth/session")` calls (`HeaderAuth.tsx:18`, `AuthForm.tsx:62`) read the session for display and post-login routing; they gate nothing |
| UI v2: XSS | Pass | No `dangerouslySetInnerHTML` or `innerHTML =` in `apps/web/src` (the production-code scan is enforced by `server/m4-gate.test.ts:77`; the matches elsewhere are test helpers). New links use internal paths built from slugs/ids. AI `rationale` is not rendered in any component |
| CSP and headers | **Unchanged** | `security-headers.ts` and `middleware.ts` have no commits after tasks #40/#55. Nonce + `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`, `img-src` limited to self + storage origin. Not stronger, so the pre-existing gaps stand (`style-src 'unsafe-inline'`, no HSTS: SEC-LIVE-09) |
| Staging: exposed ports | Needs tightening (SEC-LIVE-01) | Published: web `:181` and MinIO S3 `:84` on all interfaces (required for browser presigned PUT and public media); Mailpit UI loopback only `:67`; MySQL, Redis, ClamAV, MinIO console, workers not published. Redis ACL gives the egress worker only its queues (`:48`) |
| Staging: ACLs, buckets | Pass | `rp-ingest/rp-private` anonymous none, only `rp-public` anonymous download (`:124`); web user can only PUT `rp-ingest/in/*` and GET private media (`rp-web.json`); ledger and archive users write-only / read-only (`:134-136`); lock + retention on both locked buckets (`:126-129`). CORS pinned to `APP_URL` (`:83`) |
| Staging: secrets by name | Pass | Every secret is `${NAME:?}`; values are generated into a mode-600 gitignored file (`staging-up.sh:48,56-63`); `.dockerignore` excludes `.env.*`; the build bakes only a placeholder DB URL |

### 9.3 New findings

| ID | Sev | Title | Where | Fix |
|---|---|---|---|---|
| SEC-LIVE-01 | P2 | Staging is served over plain HTTP on all interfaces, with six demo role accounts (incl. staff) sharing one password; MinIO S3 is also public | `docker-compose.staging.yml:181,84`; `scripts/staging-up.sh:53-55,63`; `packages/db/prisma/seed-demo.ts:23-30` | Bind with `"${STAGING_BIND:-127.0.0.1}:${WEB_PORT:-3000}:3000"` (same for MinIO) and put a TLS reverse proxy or VPN in front; or restrict the ports to the tester network with a host firewall. Document that `DEMO_PASSWORD` is rotated by editing `.env.staging` then `staging-up.sh reseed`. Never point staging at real e-mail or real user data |
| SEC-LIVE-02 | P2 | Demo-seed guard is a deny-list: with `NODE_ENV` and `APP_ENV` both unset (or `prod`, `live`) it runs against whatever `DATABASE_URL` is set | `packages/db/prisma/seed-demo-guard.ts:11-12`; `docker-compose.staging.yml:160` sets `NODE_ENV: development` | Make it an allow-list: require `APP_ENV` in `{staging, development, test}` and throw otherwise; keep the production refusal; add a test for the unset and `prod` cases in `apps/worker/src/seed-demo.test.ts` |
| SEC-LIVE-03 | P2 | Legacy `seed.ts` has no environment guard, creates `admin@example.com` with ADMIN rights, and prints a generated password to stdout | `packages/db/prisma/seed.ts:9-14,19-26` (script `packages/db/package.json:16`) | Reuse `assertDemoSeedAllowed`, refuse production, require the passwords from env, never print them (print the variable name) |
| SEC-LIVE-04 | P2 | An obedient model returning valid all-zero scores is approved; `instructionLike` is still computed and ignored (SEC-FIN-07 / SEC-M6-10 stay Open); the stub run cannot show model behaviour | `packages/core/src/moderation/assess.ts:19,35`; `ai/prompt.ts:16-18`; `docs/security/ops-009-stub-run.md` | When `instructionLike` is true and the verdict would be CLEAN, return UNSURE with a reason code so a human decides. Add a stub case "obedient with valid zero scores" to `live-provider.test.ts`. Run the corpus once against the real model on staging and append the verdict table (OPS-009) |
| SEC-LIVE-05 | P2 | Content-induced `schema` failures count against the circuit breaker; a user posting crafted text can open it and push all moderation to the human queue | `packages/core/src/moderation/assess.ts:31`; `ai/breaker.ts:14-22` | Record only transport-class failures (timeout, network, 5xx, 429) in the breaker; treat `schema` as a per-item failure. Alert on a sustained UNSURE ratio |
| SEC-LIVE-06 | P2 | Daily cap is in memory: one unit per assessment although up to `maxAttempts` calls are made, reset on restart, multiplied by replicas; the breaker singleton ignores later config changes | `apps/worker/src/moderation/live.ts:24-27,36`; `assess.ts:27-30`; `ai/breaker.ts:26-35` | Count attempts, not assessments, with a Redis `INCR` + TTL keyed by UTC day; set a provider-side spend limit on the key; rebuild the breaker when `config.ai.circuitBreaker` changes |
| SEC-LIVE-07 | P2 | The exported legacy `assess` path sends an empty `system` prompt, so any caller using it with a real provider loses the pinned prompt | `packages/core/src/moderation-provider.ts:79-83` | Import `SYSTEM_PROMPT`/`buildUserMessage` there, or make it throw for real providers. No current worker caller uses it |
| SEC-LIVE-08 | P2 | The staging web image runs `next start` from a tree with dev dependencies, `tsx`, prisma tooling and full source, owned by the runtime user; the `web` service has no `read_only`, `cap_drop` or `no-new-privileges` | `infra/docker/web.Dockerfile:9-18`; `docker-compose.staging.yml:174-213` | Multi-stage build: run `migrate` from a tooling target, ship `next start` from a slim runtime target; add `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, `read_only: true` with a tmpfs for `.next/cache` to the `web` service |
| SEC-LIVE-09 | P2 | No `Strict-Transport-Security` header (pre-existing); staging pulls `minio/minio:latest` and `minio/mc:latest`; staging `ARCHIVE_DATABASE_URL` uses the application DB credential (SEC-FIN-08/-10 carry-over) | `apps/web/src/server/security-headers.ts:34-41`; `docker-compose.staging.yml:77,96,244` | Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` when `APP_URL` is https; pin image digests; use a separate archive DB user before production |

Open from earlier reviews, unchanged and not blocking: SEC-FIN-04..-09, -10..-12 (-07 is repeated as SEC-LIVE-04). SEC-FIN-13 (live OPS-009, OPS-005 pen test) cannot be closed by review.

### 9.4 Launch gate update

- [x] SEC-FIN-01 fixed (code), [x] SEC-FIN-02 fixed (config), [x] SEC-FIN-03 fixed
- [ ] OPS-009 run with the real transport and a spend-capped sandbox key (append the verdict table to `ops-009-stub-run.md`); do it after SEC-LIVE-04's change
- [ ] DevOps evidence: INSERT-only grant on `audit_logs` and `moderation_decisions` and a verification query, egress policy applied, object lock confirmed on `rp-ledger` and `rp-audit-archive`
- [ ] SEC-LIVE-01 before sharing the staging URL beyond the internal network; SEC-LIVE-02/-03 before the first production deploy
- [ ] Re-run `pnpm audit --prod`, gitleaks, `pnpm qa` and the CI integration job on the release commit
