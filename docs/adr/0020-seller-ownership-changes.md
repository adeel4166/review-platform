# ADR-0020: Seller ownership changes as one delayed, two-party flow (refines ADR-0017)

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #54 (M3b-03) |
| **Related** | ADR-0017; m3-sellers-spec §4.3, §4.6; [m3b-spec.md §3](../architecture/m3b-spec.md#3-ownership-changes-sel-006-o-6-adr-0020); threat O-6; catalogue SEL-006; ADR-0019 (2FA, step-up) |

## Context

O-6 requires that an ownership transfer needs 2FA from both parties, a 72 h delay, notification to all OWNERs, a
cancel link and audit. The M3 spec sketched only "OWNER A transfers to member B". With more than one OWNER, two
gaps appear:

- M3a lets an OWNER remove **any** member except the last OWNER. A compromised co-owner could therefore remove the
  other OWNERs instantly, which defeats the delay on additions.
- "B accepts after 72 h" (the §4.6 wording) makes B wait three days before they can act, with no security gain:
  the delay protects against a compromised A, and execution re-checks everything anyway.

## Decision

1. One table, `SellerOwnershipTransfer`, with three kinds: `ADD_OWNER`, `TRANSFER` (the initiator steps down to
   MANAGER/RESPONDER or leaves) and `REMOVE_OWNER` (demote or remove another OWNER). **Direct removal or demotion of
   another OWNER is no longer allowed.** Leaving voluntarily stays immediate (except the last OWNER).
2. At most one open change per seller (`openKey` unique).
3. Create: OWNER, 2FA-verified session and step-up with code. The target must be an existing member with 2FA
   enrolled (invitations still never grant OWNER). Accept: the target, 2FA-verified session and step-up with code.
   REMOVE_OWNER needs no acceptance, but the target can cancel.
4. The target may accept at any time before `acceptBy` (7 d). **Nothing changes before `executeAfter`
   (createdAt + 72 h)**. That floor is a DB CHECK, so configuration cannot shorten it. A job executes at
   `executeAfter`, with a 5-minute sweeper as backstop.
5. Execution re-checks everything under row locks (seller not blocked, parties' roles, ACTIVE, 2FA enrolled, ≥ 1
   OWNER after). Any failure ends the change as `FAILED` with a reason and no role change.
6. Every OWNER and the target receive a single-use cancel link (hash stored, URL fragment). It works **without
   sign-in** because cancelling is protective. In-app cancel by the initiator, any OWNER or the target skips the 2FA
   gate for the same reason. A reminder is sent 24 h before execution.
7. Any membership change of the initiator or target cancels the open change in the same transaction.

## Alternatives considered

| Option | Why not |
|---|---|
| Transfer only (no co-owner, no delayed removal) | Leaves the instant-removal takeover path open, and sellers need co-owners |
| Accept only after the 72 h delay (ADR-0017 §4.6 wording) | Same security, worse UX, and an extra 7-day window to track |
| Cancel requires sign-in and 2FA | A victim whose account is compromised must still be able to stop a takeover from the email alone |
| Grant OWNER through invitations with a delay | Mixes two token flows and lets a non-member become OWNER. Inviting as MANAGER, then ADD_OWNER, keeps one path |

## Consequences

**Positive:** no single compromised OWNER can add or remove an OWNER without 72 h of warning to every OWNER.
The ≥ 1 OWNER invariant holds by construction. One state machine covers all OWNER-set changes.

**Negative / risks:** a hostile OWNER can cancel every change aimed at them, which is a stalemate that needs the
ADMIN recovery procedure (M3-Q3, M3b-Q13). Changing ownership now takes at least 72 h, which must be explained in
the UI.

## Follow-ups

- M3b-05 implements it. QA: SEL-006 and SEL-020…SEL-030.
- Support runbook: stalemate and lost-access recovery stay manual (ADMIN, audited).
