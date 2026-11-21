# ADR-0014: Seller ownership claims: methods, auto-approval policy and state machine

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #44 (M3-01) |
| **Related** | [m3-sellers-spec.md §2, §5](../architecture/m3-sellers-spec.md), data-model §6.3 (amended), moderation-pipeline §6.3 (amended), threat model O-1…O-4, ADR-0003, ADR-0018 |

## Context

A verified seller can, from M3b on, reply in a brand's name on every review of its products. A fraudulent claim
(O-1, rated **Critical**) lets an attacker speak for a competitor or harm them. The draft had five proof methods,
labelled them "automatic" or "ADMIN" in one table, and had no conflict, contest, second-reviewer or grace rules. The
catalogue needs those rules for SEL-001…SEL-012.

## Decision

1. **Methods:** `DNS_TXT`, `META_TAG`, `BUSINESS_EMAIL_DOMAIN`, `DOCUMENT`, `MARKETPLACE`. These shorter names replace
   the draft names.
2. **Auto-approve (RULE):** DNS_TXT, META_TAG and BUSINESS_EMAIL_DOMAIN, for **scope SELLER only**, and only when
   there is no conflict, no name-similarity flag, and the claimant is still an OWNER/MANAGER with a verified email.
   They are spot-checked after approval at 10 % / 10 % / 25 %.
3. **Human review (STAFF, `seller.claim.review`):** DOCUMENT and MARKETPLACE **always**, every PRODUCT-scope claim
   (enforced by CHECK: PRODUCT allows only DOCUMENT/MARKETPLACE), and any automatic claim that hits a forcing
   condition. **Two distinct, non-conflicted approvers** are needed for brand conflicts, high-volume targets, flagged
   names and every contest.
4. **Domain policy:** a claimable domain must equal its registrable domain under an **ICANN** public suffix. Private
   suffixes (`github.io`, `myshopify.com`, `wixsite.com`, …), shared-host and free-mail deny-lists and IP literals are
   refused. Domains are stored and displayed as A-labels.
5. **Challenge:** 256-bit random per claim, unique, expires after 72 h. DNS goes at `_rp-verify.<domain>`.
6. **States:** `PENDING → VERIFIED | REJECTED | CONTESTED | EXPIRED | WITHDRAWN`, `CONTESTED → VERIFIED | REJECTED |
   WITHDRAWN`, `VERIFIED → EXPIRED | REVOKED`. Terminal states have no exits. Every change goes through
   one `applyClaimTransition()` with the transition table in spec §5.5.
7. **Never two sellers verified on one domain.** This is a DB guarantee through the unique `verifiedDomainKey`. A
   claim with valid evidence against an incumbent becomes **CONTESTED**. The incumbent is notified and stays verified
   until two ADMINs decide.
8. **Re-verification grace and downgrade:** DNS/META are re-checked monthly. Other methods are valid for 12 months
   with reminders. A failure opens a **14-day grace** (the claim stays VERIFIED with `graceEndsAt`). Then it becomes
   EXPIRED, and the seller is **downgraded** by the derived `computeSellerStatus()` in the same transaction.
9. **SEL-011:** `Seller.status = VERIFIED` needs `verifiedClaimId` (CHECK), the claim must be of the same seller
   (composite FK), and it must be a VERIFIED SELLER-scope claim (service invariant plus a daily consistency sweeper).

## Alternatives considered

| Option | Why not |
|---|---|
| All claims human-reviewed | Safe, but DNS/META are strong proofs and staffing is already the bottleneck (C-7). Spot-checks cover the residual risk |
| Auto-approve DOCUMENT with AI document checks | Forgeries are cheap, and O-1 is Critical. The threat model requires humans |
| Reject any claim on a domain verified elsewhere | Blocks the legitimate new owner of a re-registered or sold domain (the reverse of O-4). Contest keeps both safe |
| A `GRACE` claim status | Every badge and permission query would need two statuses. A timestamp on VERIFIED is simpler and CHECKed |
| Allow subdomain or private-suffix claims for DNS/META | `shop.github.io` proves control of a page, not of a brand. Those sellers use MARKETPLACE with human review |

## Consequences

**Positive:** Fraud paths in O-1…O-4 have a DB or single-function control and a test id. Legitimate brands verify in
minutes with DNS/META.

**Negative / risks:** Contests and second reviews add ADMIN load. The 14-day grace leaves a taken-over domain verified
for up to 14 days unless staff revoke. The PSL snapshot and deny-lists need upkeep (M3-Q7).

## Follow-ups

- M3-06/M3-07 implement the spec. QA adopts SEL-014…SEL-019.
- Appeal of a claim rejection through `Appeal.ownershipClaimId` arrives with the M6 `Appeal` table (M3-Q5).
