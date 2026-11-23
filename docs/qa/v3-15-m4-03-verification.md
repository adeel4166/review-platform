# V3-15: Verification of task #69 (Verified Buyer proof pipeline) against current code

Date: 2026-11-23 · Branch: `task/114` · Method: read-only code review + unit-test run. No production code changed.

## 0. Scope note (ID mismatch)

Task #69 is titled "M4-03: Verified Buyer purchase proof pipeline and decisions". In `docs/architecture/m4-m5-spec.md` §0 the ID **M4-03 is *Votes*** (migration `20261215000000_review_votes`); the Verified Buyer proof work is **M4-05** (§5, migration `20261222000000_purchase_proofs`). The task text of #69 itself is not in the repo, so its acceptance criteria are taken as the normative content of spec §5 (5.1–5.10), ADR-0008 and the PRV-* cases of `docs/qa/test-case-catalogue.md`. Recommend renaming #69 to "M4-05" when closing it.

## 1. Test results

| Suite | Command (run in the package dir) | Result |
|---|---|---|
| Worker: `m4.test.ts`, `m4-gate.test.ts`, `m4-close.test.ts`, `close02.test.ts` | `npx vitest run src/m4.test.ts src/m4-gate.test.ts src/m4-close.test.ts src/close02.test.ts` | **4 files, 62 tests passed** |
| Web: `server/m4.test.ts` | `npx vitest run src/server/m4.test.ts` | **1 file, 33 tests passed** |
| Core: `src/m4.test.ts` (hashing, auto-verify guard, eligibility) | `npx vitest run src/m4.test.ts` | **1 file, 21 tests passed** |

Not run: `*.int.test.ts` (need live MySQL, CI-only) and Playwright E2E.

## 2. Criterion-by-criterion table

Paths: W = `apps/web/src/server/proofs.ts`, K = `apps/worker/src/proofs.ts`, C = `packages/core/src/proofs.ts`, M = migration `20261222000000_purchase_proofs`.

| # | Criterion (spec §) | Status | Evidence |
|---|---|---|---|
| 1 | `PurchaseProof` / `PurchaseProofFile` models, states DRAFT/PENDING/VERIFIED/REJECTED/EXPIRED/WITHDRAWN (§5.2, §12.3) | MET | `schema.prisma:1226` (PurchaseProof), `:1283` (File), enums `:1060,:1066`; M creates `purchase_proofs`, `purchase_proof_files` |
| 2 | DB invariants: one open proof per review, decision/reject-reason/close-reason/marketplace/label CHECKs (§5.3, `check-constraints.sql`) | MET | M:47 unique `openKey`; M:135-140 `chk_review_verified_label`, `chk_proof_open_key`, `chk_proof_decision`, `chk_proof_reject_reason`, `chk_proof_close`, `chk_proof_marketplace`. Tests are fake-DB only; CHECKs are exercised only in CI MySQL |
| 3 | Label set only by staff decision; no job sets it; `PROOF_AUTO_VERIFY=true` refuses to start (§5.1) | MET | W:196 `decideProof` is the only writer (W:~215 `review.updateMany`); C:86 `assertNoAutoVerify`, called W:8 and `processors.ts:4`; tests `m4.test.ts` (worker) "PRV-016: processModeration never sets the verified label", core `m4.test.ts:61` |
| 4 | Eligibility: author only, status PENDING/HIDDEN/PUBLISHED, not already verified, not revoked, one open, attempts ≤ 3 (§5.3) | MET | W:24 `createProof`, C:76 `proofEligibility`, `PROOF_MAX_ATTEMPTS=3`; web test "eligibility matrix" (`m4.test.ts:~180`) |
| 5 | Consent version gate → 400 `consent_required` (§5.3) | MET | W:39; core `PROOF_CONSENT_VERSION`; covered via web proofs tests (create requires matching version) |
| 6 | Proof creations 5/user/day (§5.3) | MET | `ratelimit.ts:109 limitProofCreate`, wired `api/reviews/[id]/proofs/route.ts:15`; `server/m4-gate.test.ts` imports and exercises it |
| 7 | Marketplace order reference HMAC-hashed, never stored raw, fail closed (503) without key, key rotation lookup (§5.3, §5.5.4, PRV-024) | MET | W:41-50, C `hashOrderRef`/`orderRefCandidates`; web test "marketplace order reference is hashed (HMAC), never stored raw…"; core `m4.test.ts` |
| 8 | File slots: ≤5 files, type allow-list, ≤10 MiB, private presigned PUT (§5.3, §5.7) | MET | W:75 `createProofFileSlot` (413/415/409 `proof_file_limit`), key `in/proof/{id}` |
| 9 | Confirm → outbox `proof.file_uploaded`; submit needs ≥1 file, sets `slaDueAt` +72 h (§5.4) | MET | W:90, W:102; web test "submit needs a confirmed file; …" |
| 10 | Author API: list own proofs without staff identity/flags; DELETE withdraws, label stays (§5.7, PRV-007) | MET | W:120, W:130; routes `api/proofs/[id]/route.ts`, `api/reviews/[id]/proofs/route.ts`; worker `m4-close.test.ts:98,113` PRV-007; web `m4.test.ts:94` (review delete withdraws open proofs) |
| 11 | Validate type/polyglot/PDF, ClamAV before storage, original private, redacted derivative (§5.4, SEC-M5-02) | MET | K:61 `processProofFile`; `close02.test.ts:294` (malware → REJECTED, quarantined), `:223` (20-page PDF), `:307` (50 MP cap) |
| 12 | Redaction fail-closed: FULL_MASK on any doubt; nothing unredacted exposed; no network (PRV-005, PRV-023) | MET (fail-closed path) | K:42 `failClosedRedactor`; `m4.test.ts:76`; `m4-gate.test.ts:49`; `m4-close.test.ts:136,146,156` |
| 13 | **OCR (tesseract) + PII detection (email, phone, card, IBAN, address, barcodes) with AUTO mode** (§5.5 steps 1-3) | **MISSING** | Only fail-closed redactor wired. K:36 comment "The OCR adapter lands with M5-02"; `processors.ts` wires `failClosedRedactor`. Every proof is FULL_MASK, so staff see only a black page (no merchant/date/total boxes retained). Staff cannot actually verify real proofs from redacted copies. Already tracked as QA-M4-03 (`m4-gate-report.md:90`) |
| 14 | No OCR text / raw order number / EXIF persisted (PRV-001) | MET | K header comment + `m4-gate.test.ts:30` PII canary |
| 15 | Forgery signals as booleans (`PRODUCER_EDITOR`, `PDF_MODIFIED`, `IMAGE_EDITOR_TAG`, `ELA_ANOMALY`) (§5.5.5) | **MISSING** | Flag names exist in `C:15` only; no code computes them (grep over apps/ and packages/ finds no producer) |
| 16 | `filesReadyAt` + `proof.files_ready` when all files terminal; all rejected → EXPIRED(NO_VALID_FILES) (§5.5.6, PRV-019) | MET | K:127 `finalizeProof`; `m4.test.ts:76,90` |
| 17 | `verification.assess-proof`: redacted pages only, budget skip → `AI_SKIPPED`, never decides (PRV-004, PRV-020) | PARTIAL | K:164 `assessProof` + `m4.test.ts:107`. But `processors.ts:75,78` wires `extractor: null`, `takeBudget: async () => true`: no provider, so every proof is "skipped"; `PROOF_AI_DAILY_BUDGET` (500) not enforced. Acceptable per spec (R-10, queue works without hints) but the AI-hint half is not live |
| 18 | Duplicate checks: same sha256, same order hash other/same account, date and product flags, `DUPLICATE_PROOF_DETECTED` signal (PRV-008, PRV-025) | MET | K:164-210; `m4.test.ts:124`; web order-hash flag at W:46-47 |
| 19 | pHash near-duplicate flag `NEAR_DUPLICATE_IMAGE` (distance ≤ 6) (§5.6 table) | **MISSING** | No pHash code in proofs path (grep: only unrelated `NEAR_DUPLICATE_TEXT` in trust) |
| 20 | Staff queue: PENDING with `filesReadyAt`, ordered by `slaDueAt`, role guard (§5.6) | PARTIAL | W:148 `listProofQueue`, `api/admin/proofs/route.ts`, `app/admin/proofs/page.tsx`. Orders by `slaDueAt, id` only (spec: then flag weight); "author's earlier proof outcomes (counts)" not returned; 2FA check lives at route/session layer (SEC-M4-03 test `m4.test.ts:355`) |
| 21 | Staff detail: redacted pages only, 300 s signed URLs, audit `proof.view_redacted` with reason, COI (§5.6, PRV-018, QA-M4-01) | MET | W:174 `getProofDetail`; web tests `m4.test.ts` "PRV-018…", "QA-M4-01…" (×2) |
| 22 | Decision: conditional update, REJECTED needs reason, VERIFIED sets 3 label fields atomically, concurrent decision → 409, `TrustSignal`, audit, outbox, COI (§5.6) | MET | W:196 `decideProof`; web test "submit needs a confirmed file; decide needs filesReadyAt; VERIFIED sets the label fields together; second decision 409", "rejection with fraud reason writes PROOF_REJECTED_FRAUD…" |
| 23 | Label revocation (EnforcementAction, fields cleared together, proof unchanged, email, step-up, senior role) (PRV-013) | PARTIAL | W:237 `revokeVerifiedLabel`; test "PRV-013: revocation clears the label…". Role tier (SENIOR_MODERATOR) and step-up are not in the function (`staff()` accepts admin/super_admin); route `verified-label/revoke/route.ts` is expected to enforce step-up. Not verified in a unit test here (route-level, not run) |
| 24 | Retention: originals purged at decision, redacted at +90 d, EXPIRED/WITHDRAWN within 24 h, `filesPurgedAt` only after HEAD 404, legal hold blocks, ledger line (PRV-006/010/022, OPS-001) | MET | K:225 `purgeProofFiles`, K:248 `sweepProofs`, W:223 enqueues `proof.purge_requested`; `m4.test.ts:134,148`; `m4-close.test.ts:98` |
| 25 | Notifications: verified / rejected / expired / label revoked (§5.9) | MET | K:315 `sendProofNotice`, dispatched `processors.ts:126`; revoked statement of reasons and RPT-005 in `m4-close.test.ts:55` |
| 26 | Label display + verified share + `?verified=true` filter, read-time computation (§5.1) | MET | `server/reviews.ts:27-46` (`verifiedPurchaseAt not null`, `verified:{count,of}`), `api/products/[id]/reviews/route.ts:14`; `/trust/verified-purchases` page exists |
| 27 | Removal of MVP path: `markVerifiedBuyer`, `StubPurchaseLookup` deleted (§5.10) | MET | No occurrences in `*.ts` of apps/packages (grep). Only a stale comment remains in `apps/web/e2e/verified-badge.spec.ts:~12` |
| 28 | End-to-end E2E of upload → decision → badge | PARTIAL | Only seeded-badge E2E-VB-001; E2E-VB-002 is `test.fixme` with an outdated "StubPurchaseLookup" rationale. Flow covered by unit/fake-DB tests only |
| 29 | Admin break-glass original access (`proof.view_original`) | out of scope (M6) | `api/admin/proofs/[id]/files/[fileId]/original-access/route.ts` exists; spec §0 assigns it to M6 |

Summary: 21 MET (row 12 only for the fail-closed path), 4 PARTIAL (rows 17, 20, 23, 28), 3 MISSING (13, 15, 19), 1 out of scope.

## 3. Verdict

**#69 can NOT be closed as written.** The pipeline plumbing (state machine, eligibility, upload, finalize, staff decision, label, revocation, retention, notices, DB constraints) is implemented and its 116 unit tests pass. But the spec §5 detection half is not: real OCR redaction, forgery signals, pHash, and live AI hints are absent. Recommended: close #69 for the implemented plumbing (rename to M4-05) and open the follow-ups below.

## 4. Gaps as follow-up tasks

| ID | Task | Size |
|---|---|---|
| F1 | OCR redaction adapter (tesseract in sandbox), PII detectors, AUTO vs FULL_MASK selection, keep merchant/date/total boxes; replace `failClosedRedactor` in `processors.ts` (also closes QA-M4-03 / M5-02) | L |
| F2 | Forgery boolean signals (PDF producer/ModDate, EXIF Software tag, ELA) feeding `flags` | M |
| F3 | pHash `NEAR_DUPLICATE_IMAGE` (distance ≤ 6) in `assessProof` | S |
| F4 | Wire a real `ProofExtractor` provider and `PROOF_AI_DAILY_BUDGET` counter (currently `extractor: null`) | M |
| F5 | Staff queue: flag-weight ordering and author's prior-outcome counts; unit test for 2FA on admin proof routes | S |
| F6 | Route-level tests for label revoke (SENIOR_MODERATOR tier, step-up 10 min) and CI integration test of the CHECK constraints | S |
| F7 | Replace `test.fixme` E2E-VB-002 with a real upload → decision → badge E2E; fix stale comment | M |
| F8 | Housekeeping: rename #69 to M4-05 and fix ID mapping in task board | XS |
