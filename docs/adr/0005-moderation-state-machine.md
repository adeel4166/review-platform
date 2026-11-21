# ADR-0005: Moderation state machine, timers and work queues

| | |
|---|---|
| **Status** | Accepted (merged to `main` with CEO approval, proposal #9) |
| **Date** | 2026-11-20 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #19 (M1.2) |
| **Related** | [moderation-pipeline.md](../architecture/moderation-pipeline.md), ADR-0001 (outbox, BullMQ), ADR-0003 (permissions, COI), ADR-0004 (conventions) |

## Context

The product brief fixes the moderation policy:

- **Clean** → live immediately, plus an admin post-review within 24 h.
- **Clear violation** → rejected and appealable.
- **Unsure** → hidden, in the admin queue, held for 7 days, then auto-rejected with a notification and an open appeal.
- **AI provider failure** → treated as Unsure.
- AI thresholds must be configurable. Staff need a moderation queue (AI score/reason, bulk actions), an appeal queue
  and a seller-verification queue.

M1.1 (data-model.md §6.1) only sketched a lifecycle in which uncertain content stayed `PENDING` and had no timers.
We now need exact states, timers that survive restarts, and a way to change thresholds without a deploy.

## Decision

1. **Three verdicts** (`CLEAN`, `VIOLATION`, `UNSURE`) computed from per-category scores against a
   `{clean, violation}` threshold pair, after deterministic rules. Violation wins; any provider failure (timeout,
   5xx, 429 after retries, malformed response, unsupported language, open circuit breaker, lost job) yields `UNSURE`.
   The pipeline never auto-approves on error.
2. **Content states:** `PENDING → PUBLISHED | REJECTED | HIDDEN`; `HIDDEN → PUBLISHED | REJECTED` (staff or
   7-day timer); `PUBLISHED → REMOVED | HIDDEN` (post-review / reports); `REJECTED | REMOVED → PUBLISHED` (appeal).
   `REJECTED` is a new `ContentStatus` value, distinct from `REMOVED` (taken down after being live).
   Edits of live reviews are moderated per revision while the last approved revision stays live.
3. **One transition function** (`ModerationService.transition()` in `packages/core`) applies every change in a
   single transaction (status, append-only decision, case, audit, outbox) behind a **conditional update** on the
   allowed from-states. That makes humans, timers and bulk jobs safe to race: the first commit wins, the rest no-op.
4. **Timers are database deadlines** (`holdExpiresAt`, `postReviewDueAt`, `appealableUntil`, `Appeal.slaDueAt`)
   captured at start. A BullMQ delayed job is the fast path; a 5-minute sweeper is the guarantee.
5. **Hold expiry is not a violation finding:** no strike, no enforcement action, no trust penalty, and its appeals
   get a 72 h SLA.
6. **Thresholds live in a versioned `ModerationConfig` table** (immutable JSON, one `ACTIVE`, optional `SHADOW` for
   dry-run comparison), changed by `config.manage` with step-up auth and audit. Each decision stores its
   `configVersion`. Durations are captured per item so a config change never moves existing deadlines.
7. **Staff queues are DB views** (lanes `HOLD`, `POST_REVIEW`, `REPORTED` on `ModerationCase`; `Appeal`;
   `SellerOwnershipClaim`) with 15-minute leases, COI filtering, mandatory reason codes, and bulk actions (≤ 100
   items, one job, one decision per item with a shared `bulkOperationId`). BullMQ queues only move work between
   processes.
8. **Appeals are always decided by a human** who did not take the original decision.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep uncertain content `PENDING` (M1.1 sketch) | The brief says "hidden" with a 7-day hold; `PENDING` has no deadline semantics and mixes "AI still running" with "waiting for staff" |
| Reuse `REMOVED` for pre-publication rejection | Loses the distinction needed for user copy ("rejected" vs "removed"), strike rules and DSA transparency counts |
| Timers only as BullMQ delayed jobs | Lost on Redis data loss; a missed hold expiry leaves content in limbo. DB deadline + sweeper costs one indexed query every 5 min |
| Timers only as a sweeper | Correct, but up to 5 min late on every transition; the delayed job makes the common case punctual |
| Thresholds in env vars / code | Needs a deploy to tune, no audit trail, no per-decision version, no shadow comparison |
| A workflow engine (Temporal etc.) for case lifecycles | Strong fit for long timers, but a new stateful service for a handful of transitions; ADR-0001 keeps the runtime small |
| Auto-approve on AI failure for trusted users | Violates "failure → Unsure" and opens a bypass (induce provider errors to publish) |

## Consequences

**Positive**

- Every rule in the brief maps to one row in the transition table and one table-driven test.
- Decisions are reproducible: verdict, scores, provider/model, policy and config version are stored.
- An AI outage degrades to "everything hidden", never to "everything published". Re-scan on recovery limits the backlog.

**Negative / risks**

- 100 % post-review within 24 h is a staffing commitment that grows linearly with volume (`sampleRate` lever exists).
- Auto-reject after 7 days without human review may be contested by users/regulators (Legal L-2).
- More columns on `ModerationCase` (denormalised AI fields) must be kept consistent by `transition()` only.

## Follow-ups

- ADR-0003 permission matrix: add `moderation.bulk_decide` (MODERATOR+: approve/confirm; SENIOR_MODERATOR: reject/remove).
- Provider spike (T-4): pick provider(s), map labels to the taxonomy, calibrate thresholds with shadow mode.
- T&S + Legal: policy text, reason codes, statement-of-reasons templates.
- Product: staffing model for post-review volume.
