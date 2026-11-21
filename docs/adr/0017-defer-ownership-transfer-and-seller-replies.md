# ADR-0017: Defer ownership transfer (SEL-006) and seller replies to M3b

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval, because it changes the M3 gate) |
| **Task** | #44 (M3-01) |
| **Related** | [m3-sellers-spec.md §0.1, §4.5, §4.6](../architecture/m3-sellers-spec.md), catalogue SEL-006 and AZ-010, threat model O-6/F-5, ADR-0002 (2FA), ADR-0003 guard 3, m2-security-review SEC-09(d) |

## Context

The catalogue lists SEL-006 (ownership transfer: 2FA for both parties, 72 h delay, cancel link) and AZ-010
(a RESPONDER cannot reply on another seller's product) as M3 P0. Plan #8 (M3a) covers sellers, memberships and claims.
Two blockers:

- **2FA does not exist** (SEC-09(d), target M8). A transfer without both parties' 2FA would violate the O-6
  mitigation.
- **Seller replies** need a `SellerReply` table, a moderation arc (the real `ModerationCase` is review-only), the
  `seller.reply` guard, the reply-link policy (F-5) and UI. That is a milestone of its own, and it only makes sense once
  verified sellers exist.

## Decision

1. **M3a** ships sellers, members, invitations (MANAGER and RESPONDER only), claims, the fetcher and email
   verification.
2. **M3b** ships ownership transfer and co-owner addition (using the design in spec §4.6, with 2FA or the agreed
   interim control) and seller replies with their moderation.
3. **The M3 gate is split.** The M3a gate excludes SEL-006 and the reply clause of AZ-010. AZ-010's principle
   (scope from the resource, client `sellerId` ignored) **is** in the M3a gate for every M3a seller permission. Both
   deferred items are P0 for the M3b gate.
4. Until M3b, a seller has exactly the OWNERs it was created with (one). If that OWNER loses access, recovery is a
   manual ADMIN procedure, audited (M3-Q3).

## Alternatives considered

| Option | Why not |
|---|---|
| Build transfer in M3a with password step-up instead of 2FA | Weakens the O-6 mitigation the threat model requires. Not acceptable for a takeover-sensitive flow |
| Build replies in M3a | Doubles M3a and couples it to moderation changes. Claims must be proven safe first |
| Drop SEL-006 from Phase 1 | Sellers change staff. Transfer is needed before launch |

## Consequences

**Positive:** M3a is smaller and its gate is achievable. Transfer is built on real 2FA.

**Negative / risks:** Single-OWNER sellers in M3a. The M3 gate definition in test-strategy needs a QA update. The
CEO must accept the split.

## Follow-ups

- QA: mark SEL-006 and the AZ-010 reply clause as M3b in the catalogue and in test-strategy §M3.
- PM: create M3b tasks. Decide with Security whether M3b waits for TOTP or brings TOTP forward from M8 (M3-Q1).
