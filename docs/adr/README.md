# Architecture Decision Records

We record significant architecture decisions as ADRs (lightweight Michael Nygard format).

## Rules

- One decision per file: `NNNN-kebab-title.md`, numbered sequentially and never reused.
- New ADRs start as **Proposed**. An ADR becomes **Accepted** when its PR is merged to `main` with CEO approval.
- Accepted ADRs are not rewritten. To change a decision, add a new ADR and mark the old one **Superseded by ADR-NNNN**.
- Small clarifications (typos, links, follow-up status) may be edited in place.
- Use [`template.md`](./template.md).

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](./0001-technology-stack.md) | Technology stack and runtime topology | Accepted | 2026-11-20 |
| [0002](./0002-authentication-and-2fa.md) | Authentication, sessions and two-factor authentication | Accepted | 2026-11-20 |
| [0003](./0003-multi-role-permissions.md) | Multi-role permission model | Accepted | 2026-11-20 |
| [0004](./0004-data-model-conventions.md) | Data model conventions | Accepted | 2026-11-20 |
| [0005](./0005-moderation-state-machine.md) | Moderation state machine, timers and work queues | Accepted | 2026-11-20 |
| [0006](./0006-media-storage-and-processing.md) | Media storage layout and processing pipeline (amends ADR-0001 §5) | Accepted | 2026-11-20 |
| [0007](./0007-queue-based-worker.md) | Queue-based background worker and transactional outbox contract | Proposed | 2026-11-21 |
| [0008](./0008-verified-buyer-approach.md) | Verified-buyer approach | Proposed | 2026-11-21 |
| [0009](./0009-i18n-readiness.md) | Internationalisation readiness (English default) | Proposed | 2026-11-21 |
| [0010](./0010-database-physical-naming.md) | Database physical naming (amends ADR-0004) | Proposed | 2026-11-21 |
| [0011](./0011-moderation-lifecycle-and-audit.md) | Moderation lifecycle completion and audit contract (amends ADR-0005) | Proposed | 2026-11-21 |
| [0012](./0012-media-job-decomposition.md) | Media processing as step jobs with a verified staging copy (amends ADR-0006) | Proposed | 2026-11-21 |
| [0013](./0013-outbox-fan-out-routing.md) | Outbox fan-out routing and domain job keys (refines ADR-0007) | Proposed | 2026-11-21 |
| [0014](./0014-ownership-claim-verification.md) | Seller ownership claims: methods, auto-approval policy and state machine | Proposed | 2026-11-21 |
| [0015](./0015-ssrf-safe-fetcher.md) | SSRF-safe website fetcher in an isolated worker group | Proposed | 2026-11-21 |
| [0016](./0016-email-verification-and-generic-registration.md) | Email verification, mail-provider interface and generic registration response | Proposed | 2026-11-21 |
| [0017](./0017-defer-ownership-transfer-and-seller-replies.md) | Defer ownership transfer (SEL-006) and seller replies to M3b | Proposed | 2026-11-21 |
| [0018](./0018-kyb-ownership-proof-only.md) | Seller verification is ownership proof only (no KYB) for Phase 1 | Proposed | 2026-11-21 |
| [0019](./0019-two-factor-sessions-on-authjs.md) | 2FA, step-up and revocable sessions on the Auth.js baseline (amends ADR-0002) | Proposed | 2026-11-21 |
| [0020](./0020-seller-ownership-changes.md) | Seller ownership changes as one delayed, two-party flow (refines ADR-0017) | Proposed | 2026-11-21 |
| [0021](./0021-seller-reply-content-policy.md) | Seller replies: plain text, no links, server-state visibility, shared moderation | Proposed | 2026-11-21 |
| [0022](./0022-in-house-proof-redaction.md) | Proof redaction runs in-house in the `media` group; only redacted pages reach an AI provider | Proposed | 2026-11-22 |
| [0023](./0023-ingest-least-privilege-and-publication-gate.md) | Confirm without `HEAD`, and a database-enforced publication gate (amends ADR-0006 / ADR-0012) | Proposed | 2026-11-22 |
| [0024](./0024-clock-interface-and-no-runtime-test-clock.md) | Injected `Clock` for all deadline logic, and no runtime test-clock hook in any build | Proposed | 2026-11-22 |
| [0025](./0025-moderation-engine-baseline-for-m6.md) | M6 moderation engine: one table-driven `transition()`, case status + lanes, a decision table, a fixed system-principal allow-list | Proposed | 2026-11-22 |
| [0026](./0026-four-eyes-approval-requests.md) | Four-eyes approvals as one `StaffApprovalRequest` flow | Proposed | 2026-11-22 |
| [0027](./0027-break-glass-original-proof-access.md) | Break-glass `proof.view_original`: single-use streamed access, caps, digest, second approver for repeats | Proposed | 2026-11-22 |
| [0028](./0028-ai-verdict-contract-and-injection-canaries.md) | AI verdict contract: scores only, platform-derived verdict, every failure UNSURE, injection canaries | Proposed | 2026-11-22 |
| [0029](./0029-trust-score-v1.md) | Trust score v1: capped, decaying, explainable points model with gated bands | Proposed | 2026-11-22 |
| [0030](./0030-fake-review-and-vote-defences.md) | Fake-review and vote defences: vote maturity, velocity freeze, MinHash near-duplicates, product-burst routing | Proposed | 2026-11-22 |
| [0031](./0031-notification-inbox-and-mandatory-types.md) | In-app notification inbox; mandatory types enforced on the server | Proposed | 2026-11-22 |
| [0032](./0032-m7-social-and-comparison-scope.md) | M7 social and comparison scope; comments/posts/likes deferred; no messaging | Proposed | 2026-11-22 |
| [0033](./0033-erasure-retention-and-deletion-ledger.md) | Account erasure, retention-job framework, tombstone expiry, deletion ledger | Proposed | 2026-11-22 |

### Task #24 coverage map (stack, storage, worker, verified buyer, i18n)

| Required topic | ADR |
|---|---|
| Stack (Next.js + Prisma/MySQL) | [0001](./0001-technology-stack.md), [0004](./0004-data-model-conventions.md), [0010](./0010-database-physical-naming.md) |
| Object storage (S3/R2) | [0001](./0001-technology-stack.md) §1/§5, [0006](./0006-media-storage-and-processing.md) |
| Queue-based worker | [0007](./0007-queue-based-worker.md) (builds on 0001 §4, 0005, 0006) |
| Verified-buyer approach | [0008](./0008-verified-buyer-approach.md) |
| i18n readiness (English default) | [0009](./0009-i18n-readiness.md) |

### Task #25 coverage map (moderation lifecycle and media pipeline)

| Required topic | Where |
|---|---|
| Lifecycle states (submitted … removed), transitions, actors, audit logging | [moderation-lifecycle.md](../architecture/moderation-lifecycle.md), [0011](./0011-moderation-lifecycle-and-audit.md) |
| State diagram + transition table | [moderation-lifecycle.md §2, §4, §5](../architecture/moderation-lifecycle.md#2-state-diagram) |
| Signed upload, scanning, resizing, thumbnails | [media-pipeline.md §2, §4](../architecture/media-pipeline.md), [0012](./0012-media-job-decomposition.md) |
| Job definitions, payloads, retry policy, failure handling | [job-catalogue.md](../architecture/job-catalogue.md), [0013](./0013-outbox-fan-out-routing.md) |
| Consistency with the M1-T1 schema | [moderation-lifecycle.md §8](../architecture/moderation-lifecycle.md#8-consistency-with-the-m1-t1-schema), [job-catalogue.md §8](../architecture/job-catalogue.md#8-scaffold-deltas-m2-follow-ups-backend-engineer) |

### Task #44 coverage map (M3: sellers, claims, SSRF fetcher, email verification)

| Required topic | Where |
|---|---|
| Final schema plan (Seller, SellerMember, SellerOwnershipClaim, SellerInvitation, EmailVerificationToken), CHECKs, migration order | [m3-sellers-spec.md §2](../architecture/m3-sellers-spec.md#2-final-schema-plan) |
| Claim state machine, methods, auto vs. human review (O-1) | [0014](./0014-ownership-claim-verification.md), [spec §5](../architecture/m3-sellers-spec.md#5-ownership-claims-m3-06-m3-07) |
| SSRF-safe fetcher (SEC-007, O-5) | [0015](./0015-ssrf-safe-fetcher.md), [spec §6](../architecture/m3-sellers-spec.md#6-ssrf-safe-fetcher-m3-05-sec-007-o-5) |
| Email verification, provider interface, Mailpit, generic register (SEC-05) | [0016](./0016-email-verification-and-generic-registration.md), [spec §3](../architecture/m3-sellers-spec.md#3-email-verification-and-generic-registration-m3-03) |
| Ownership transfer and seller replies deferred to M3b | [0017](./0017-defer-ownership-transfer-and-seller-replies.md) |
| KYB = ownership proof only (L-9) | [0018](./0018-kyb-ownership-proof-only.md) |
| Catalogue case → task mapping | [spec §9](../architecture/m3-sellers-spec.md#9-test-case-mapping) |

### Task #54 coverage map (M3b: 2FA, ownership transfer, business-email claims, seller replies)

| Required topic | Where |
|---|---|
| 2FA: TOTP enrol/confirm, recovery codes (HMAC), pending-2FA default-deny gate, attempt caps (A-1, A-5…A-7) | [0019](./0019-two-factor-sessions-on-authjs.md), [m3b-spec §2](../architecture/m3b-spec.md#2-two-factor-authentication-adr-0002-3-adr-0019) |
| Ownership transfer state machine (O-6): 2FA both parties, 72 h, all OWNERs notified, cancel link, audit, ≥ 1 OWNER | [0020](./0020-seller-ownership-changes.md), [m3b-spec §3](../architecture/m3b-spec.md#3-ownership-changes-sel-006-o-6-adr-0020) |
| `BUSINESS_EMAIL_DOMAIN` flow (O-2): PSL private = shared, deny-lists, role addresses, session-bound link | [m3b-spec §4](../architecture/m3b-spec.md#4-business_email_domain-claims-o-2) (within ADR-0014) |
| Seller replies (F-5, P-2): link policy, no contact details, plain text, limits, moderation reuse, `SELLER_REPLY_RESTRICTION` | [0021](./0021-seller-reply-content-policy.md), [m3b-spec §5](../architecture/m3b-spec.md#5-seller-replies-f-5-p-2-adr-0021) |
| Prisma diff, job catalogue additions, error codes, test ids | [m3b-spec §6–§10](../architecture/m3b-spec.md#6-schema-changes) |

### Task #67 coverage map (M4 + M5: votes, edits, reports, verified buyer proof, media pipeline)

| Required topic | Where |
|---|---|
| Votes: limits, self-vote ban, anti-abuse | [m4-m5-spec §2](../architecture/m4-m5-spec.md#2-helpful-votes-f-2-sec-009-az-012) |
| Review edits with revision history | [m4-m5-spec §3](../architecture/m4-m5-spec.md#3-review-edits-and-revision-history-mod-019-moderation-lifecycle-42) |
| Review reporting (reviews and seller replies) | [m4-m5-spec §4](../architecture/m4-m5-spec.md#4-reporting-reviews-and-seller-replies) |
| Verified Buyer proof: upload, redaction, retention, decision states, label rules | [0008](./0008-verified-buyer-approach.md), [0022](./0022-in-house-proof-redaction.md), [m4-m5-spec §5](../architecture/m4-m5-spec.md#5-verified-buyer-proof-adr-0008-prv-) |
| Upload slots, ClamAV, sanitise/exiftool, transcode, promotion, MED-037, INF-002/003 | [0023](./0023-ingest-least-privilege-and-publication-gate.md), [m4-m5-spec §6–§11](../architecture/m4-m5-spec.md#6-media-limits-slots-and-confirm-m5) |
| Prisma deltas, job catalogue entries, error codes, limits, test ids | [m4-m5-spec §12–§16](../architecture/m4-m5-spec.md#12-schema-changes-prisma-deltas) |

### Task #77 coverage map (M6–M8: moderation and staff, trust/social/comparison, hardening)

| Required topic | Where |
|---|---|
| Content state machine, transition engine, system principal | [0025](./0025-moderation-engine-baseline-for-m6.md), [m6-m8-spec §3, §7.4](../architecture/m6-m8-spec.md#3-content-state-machine-and-transition-engine) |
| AI verdicts, failure-to-CLEAN property (AIF-008), prompt-injection canaries (SEC-008) | [0028](./0028-ai-verdict-contract-and-injection-canaries.md), [spec §5](../architecture/m6-m8-spec.md#5-ai-verdicts-failure-handling-and-prompt-injection-adr-0028) |
| Clock / FakeClock, test-clock hook decision (OPS-003) | [0024](./0024-clock-interface-and-no-runtime-test-clock.md), [spec §2](../architecture/m6-m8-spec.md#2-clock-fakeclock-and-the-test-clock-decision-adr-0024) |
| Timers, staff queues, enforcement, appeals (wireframe 11) | [spec §4, §6, §7, §10](../architecture/m6-m8-spec.md) |
| Four-eyes on config and role grants (CFG-004, AZ-015, AZ-024) | [0026](./0026-four-eyes-approval-requests.md), [spec §8](../architecture/m6-m8-spec.md#8-four-eyes-approvals-adr-0026) |
| Break-glass `proof.view_original` (PRV-003) | [0027](./0027-break-glass-original-proof-access.md), [spec §9](../architecture/m6-m8-spec.md#9-break-glass-proofview_original-adr-0027) |
| Trust score formula, vote maturity, burst routing (TRS-001…004, TRS-008) | [0029](./0029-trust-score-v1.md), [0030](./0030-fake-review-and-vote-defences.md), [spec §15–§16](../architecture/m6-m8-spec.md#15-trust-score-v1-adr-0029) |
| Notifications, mandatory types (TRS-009) | [0031](./0031-notification-inbox-and-mandatory-types.md), [spec §17](../architecture/m6-m8-spec.md#17-notifications-adr-0031) |
| Comparison (05), profile/social (06), no messaging (SCOPE-001) | [0032](./0032-m7-social-and-comparison-scope.md), [spec §18–§20](../architecture/m6-m8-spec.md#18-social-profile-follows-blocks-adr-0032) |
| Retention, erasure (SEC-M4-09), OPS list, pen-test scope | [0033](./0033-erasure-retention-and-deletion-ledger.md), [spec §22–§24](../architecture/m6-m8-spec.md#22-retention-and-privacy-jobs) |
| Routes, Prisma deltas, jobs, test mapping per milestone | [spec §11–§14, §21, §25](../architecture/m6-m8-spec.md) |
