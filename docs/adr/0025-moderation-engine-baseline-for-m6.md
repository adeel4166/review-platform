# ADR-0025: M6 moderation engine: one table-driven `transition()`, case status + lanes, a decision table, and a fixed system-principal allow-list

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #77 (M6–M8 spec) |
| **Related** | ADR-0005, ADR-0011 (design, unchanged), ADR-0013 · [moderation-lifecycle.md](../architecture/moderation-lifecycle.md) §4–§7 · [moderation-pipeline.md](../architecture/moderation-pipeline.md) §3, §9 · [m6-m8-spec.md §3, §4, §12](../architecture/m6-m8-spec.md#3-content-state-machine-and-transition-engine) · catalogue `MOD-*`, `AZ-017`, `CLS-012` |

## Context

1. The design (ADR-0005/0011) is approved, but the code is still the M2–M4 shape: `ModerationCase.state`
   (`PENDING/AI_REVIEW/NEEDS_HUMAN/APPROVED/REJECTED/SUPERSEDED`), one AI score, no lanes, no timers, no
   `ModerationDecision` table, decisions stored on the case row (`decidedById`, `decisionReason`), and a small
   `TRANSITIONS` map in `packages/core/src/moderation-state.ts`. M4 report cases use `openReportKey`.
2. `MOD-016` needs a negative matrix generated from **one** table; `MOD-020` needs every write of a transition in one
   transaction; `MOD-017`/`TMR-013` need idempotency.
3. `AZ-017` (system principal: no SUSPENSION/BAN) conflicts with `CLS-012` (zero-tolerance → account SUSPENDED) and
   with the strike ladder (pipeline §9: 30-day posting restrictions and "5+ → SUSPENSION"), which ADR-0003 reserves for
   SENIOR_MODERATOR.

## Decision

1. **One transition table in code** (`packages/core/src/moderation/transitions.ts`): rows T1–T21, R1–R8, A1–A7 as data
   (`{id, from[], event, actors[], guard, to, decision, auditAction, effects[]}`), copied from moderation-lifecycle §4/§5.
   `transition(deps, {target, event, actor, input})` is the **only** writer of `ContentStatus`, `RevisionStatus`,
   `AppealStatus`, case lane/status/timers, `ModerationDecision`, the transition `AuditLog` row and moderation outbox
   rows. It runs a conditional `UPDATE … WHERE status IN (:from) [AND case/version guard]`; zero rows → no-op with no
   writes. The negative matrix test iterates `ContentStatus × Event` minus the table.
2. **Case model:** `ModerationCase.state` is replaced by `status CaseStatus {OPEN, IN_REVIEW, ESCALATED, RESOLVED}` +
   `lane ModerationLane {HOLD, POST_REVIEW, REPORTED}` (+ `INTEGRITY` in M7, ADR-0030) + `outcome`, `resolutionCode`,
   timers and lease columns, as in the draft schema. `openReportKey` generalises to `openKey = "<lane>:<target>"`
   (unique while open), which enforces lifecycle invariant 5 ("one open case per target and lane") in the database.
   Per-assessment data moves to a new append-only `ModerationDecision` table. Legacy columns are back-filled and
   dropped in the same M6 migration (pre-launch, no production data: D-A1 of the M4/M5 spec).
3. **System principal allow-list** (`packages/core/src/authz/system-principal.ts`), replacing the implicit ambient
   authority of jobs:
   - may write `ModerationDecision` (source `AI`/`RULE`/timer) and run the AI/RULE/TIMER rows of the table;
   - may issue `WARNING`, `CONTENT_REMOVAL`, and the strike-ladder `POSTING_RESTRICTION`/`VOTING_RESTRICTION` with
     `issuedById = null` and `reasonCode STRIKE_LADDER_<n>`;
   - may issue **one** protective `SUSPENSION` only when the deciding verdict is a `strikes.zeroTolerance` category
     (`reasonCode ZERO_TOLERANCE_HOLD`, `endsAt = null`, case `ESCALATED`, SENIOR_MODERATOR SLA 24 h);
   - may **never** issue `BAN`, `SELLER_SUSPENSION`, `VERIFIED_LABEL_REVOKED` or any other `SUSPENSION`.
   At 5+ strikes the ladder issues an indefinite `POSTING_RESTRICTION` and escalates; a SENIOR_MODERATOR decides
   `SUSPENSION`/`BAN`. `AZ-017` is re-worded to "BAN, and SUSPENSION outside the zero-tolerance hold, → denied".
4. **Report-count rule (QA §9.11 / F-9) confirmed as ADR-0011 decided:** T11 never hides content; only T15 (AI
   `VIOLATION` on re-scan, or a staff hide) does. `MOD-012` must be rewritten to T11/T15/T16; `MOD-022` stands.
5. **`ModerationTrigger`** gains `STAFF_FLAG` (T11 by staff) and `STAFF_INITIATED` (pipeline §4.3 race recovery).
   No `APPEAL` trigger is added (closes LC-1: appeals append to the original case).

## Alternatives considered

| Option | Why not |
|---|---|
| Extend the existing `ModerationState` enum with lane-like values | Mixes workflow state with queue routing; the lane timers and CHECKs (`chk_case_hold_expiry`) cannot be expressed; diverges from the approved design |
| Keep decisions on the case row | Loses the history the appeal screen and `appealableUntil` logic need; a case gets several decisions (AI, then human, then appeal) |
| Let the system principal issue any enforcement the ladder names | Contradicts P-9/AZ-017 and ADR-0003 (SUSPENSION/BAN are SENIOR_MODERATOR, step-up for BAN) |
| No automatic action on zero-tolerance hits | Leaves a confirmed CSAM uploader able to post until a human looks; pipeline §9 and L-17 require immediate containment |

## Consequences

**Positive:** one place encodes the lifecycle; the tests are generated from it; the DB enforces one open case per
lane; AI authority is a short, testable list.

**Negative / risks:** the M6 migration rewrites the M4 case code paths (admin list/detail/decide, report cases,
seller-reply moderation). The zero-tolerance exception is a deliberate hole in `AZ-017` and must stay that narrow.

## Follow-ups

- QA: update `AZ-017`, `MOD-012` wording; add `MOD-023…` for T15–T21 and A1–A7 rows (ADR-0011 follow-up still open).
- Backend (M6-A): transitions table, migration `20270105000000_moderation_m6`.
