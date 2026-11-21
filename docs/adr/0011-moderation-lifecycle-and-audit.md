# ADR-0011: Moderation lifecycle completion and audit contract (amends ADR-0005)

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #25 (M1-T2) |
| **Related** | ADR-0005 (state machine, amended here), ADR-0003 (permissions), ADR-0004 (append-only audit), [moderation-lifecycle.md](../architecture/moderation-lifecycle.md), [moderation-pipeline.md](../architecture/moderation-pipeline.md), threat-model F-9, test-strategy §9.7/§9.11 |

## Context

The M1-T2 brief names eight lifecycle states: *submitted, auto-screened, pending manual review, published,
rejected, appealed, reinstated, removed*. Each needs transitions, actors and audit logging. ADR-0005 defined
`ContentStatus` and transitions T1–T14. A review of that design against the brief, the threat model and the QA
catalogue found five problems:

1. *Appealed* and *reinstated* have no defined storage. *Auto-screened* is not a state at all.
2. Content hidden after reports (T11) had no exit: no restore and no removal row. T11 also auto-hid content on a
   report count, which contradicts threat F-9 (QA §9.11).
3. Authors could not delete or fix `REJECTED`/`REMOVED` content. Because `Review` is unique per
   `(productId, authorId)`, a rejected review would block that author from that product for good.
4. Reporters may appeal "no action" decisions (L-3), but no transition carried out an overturn.
5. "Every transition writes an `AuditLog` row" did not say which action, which actor type, or what metadata.

## Decision

1. **Five stored states, three derived ones.** `ContentStatus` is unchanged. *Auto-screened* is the AI/RULE
   `ModerationDecision`, committed in the same transaction as the next transition. *Appealed* means an open `Appeal`
   on a `REJECTED`/`REMOVED` deciding case. *Reinstated* means `PUBLISHED` with `resolutionCode = APPEAL_OVERTURNED`.
   One function in `packages/core`, `lifecycleState()`, derives them.
2. **Report flow (resolves F-9):** T11 keeps content live and moves the case to the `REPORTED` lane with a re-scan.
   Only an AI **VIOLATION** on re-scan, or a staff "Hide", restricts it (T15). Restricted content leaves that state
   only through a human (T16 restore, T17 remove). There is no timer outcome.
3. **New rows T15–T21:** restrict, restore, report-upheld removal, reports dismissed, author delete from
   `REJECTED`/`REMOVED`, author resubmit (forced to human review after a human decision), and reporter-appeal
   overturn. Revision rows R1–R8 and appeal rows A1–A7 are written out. R7 confirms that the hold timer also expires
   held revisions.
4. **Appeal and overturn decisions are appended to the original case.** One case therefore holds the full decision
   history. `ModerationTrigger.APPEAL` is unused in Phase 1.
5. **Audit contract:** each committed transition writes exactly one `AuditLog` row in the same transaction, with
   `action = <entity>.<verb>` from the lifecycle table. The actor maps to `AuditActorType` as AUTHOR/REPORTER →
   USER, staff → STAFF, AI → AI, rules and timers → SYSTEM. `metadata` carries ids, codes and versions only (no
   user content). No-ops write nothing.
6. **Schema:** add `Appeal.leaseExpiresAt` (appeal claim lease). Document the new `resolutionCode` values.

## Alternatives considered

| Option | Why not |
|---|---|
| Add `APPEALED` and `REINSTATED` to `ContentStatus` | Loses "rejected vs removed" while an appeal is open. Every `PUBLISHED` query would also need `REINSTATED`. Duplicates the `Appeal` state |
| Persist an `AUTO_SCREENED` status | Adds an extra commit between the verdict and its effect, plus a state that can get stuck, for no reader benefit |
| Keep T11 auto-hide on report count | Lets a report flood take down competitors' reviews (F-9) |
| Time out restricted (T15) items to remove or restore | Auto-removal of content that was live, without a human, breaks ADR-0005 intent. Auto-restore rewards abuse |
| A new `ModerationCase` per appeal | Splits the decision history across cases. `Appeal` already is the work item |
| Audit only staff actions | Then the trail of AI and timer decisions on user content would live only in domain tables, without actor or job context |

## Consequences

**Positive:** every brief state has an exact representation and test oracle. The report-flood conflict is closed.
Users can always delete or fix their own content. The audit is uniform and queryable by `action`.

**Negative:** about two audit rows per submission (submit + auto-screen), which adds write volume (fine at Phase 1
scale; 2-year retention, data-model §7). Restricted items need staff attention, and a 48 h SLA alert covers that.

## Follow-ups

- QA: add `MOD-*` cases for T15–T21, R1–R8 and A1–A7. Change `MOD-012` to the new T11/T15/T16 semantics. Generate
  the negative matrix from moderation-lifecycle.md §4.
- M6 migration: drop `ModerationTrigger.APPEAL` unless a use appears (LC-1). Add the `timers.reportedSlaHours` config key.
