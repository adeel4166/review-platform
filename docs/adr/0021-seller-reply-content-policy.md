# ADR-0021: Seller replies are plain text without links, shown from server state, moderated by the shared pipeline

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval). Trust & Safety (policy lists) |
| **Task** | #54 (M3b-03) |
| **Related** | ADR-0003 (`seller.reply`), ADR-0005/ADR-0011 (moderation), [m3b-spec.md §5](../architecture/m3b-spec.md#5-seller-replies-f-5-p-2-adr-0021); threats F-5, P-2, P-8, R-4; open question M3-Q14 (ModerationCase arc) |

## Context

F-5: seller replies can carry phishing, off-platform bait ("WhatsApp us for a refund") or harassment, and a seller
could reply in another seller's name. The M3 security review asks for a link policy (none or allow-list), no contact
details, no markdown/HTML, rate limits, the same AI-first moderation, `SELLER_REPLY_RESTRICTION` and authorization
from the review → product → seller mapping. `ModerationCase` is review-only today (`reviewId` required, Cascade FK).

## Decision

1. **Plain text only.** No markdown, no HTML, no auto-linking. The renderer outputs an escaped text node and has no
   code path that creates anchors.
2. **No links in Phase 1** (`replies.linkPolicy = "none"`). URLs, bare domains, email addresses, markup and
   invisible/bidi characters are hard-rejected with reasons shown to the seller. Phone numbers and messenger
   keywords are soft flags that force human review. An allow-list mode (the seller's own verified domain, still as
   text) is reserved.
3. **Scope from the resource:** the seller is `product.sellerId` of the review's product, loaded on the server. A
   non-member gets 404. The seller must be VERIFIED. OWNER/MANAGER need a 2FA-verified session.
4. **Visibility is computed at render time:** a reply is public only while it is PUBLISHED, its seller still owns
   the product and the seller is VERIFIED. Downgrades and contest losses hide replies without a batch job.
5. **Shared moderation pipeline:** `ModerationCase` gains a subject arc (`subjectType`, `sellerReplyId`, CHECK
   `chk_case_subject`) now, for `SELLER_REPLY` only. This pulls part of M3-Q14 forward. The `reviewId` FK becomes
   Restrict. A seller's first 5 replies and soft-flagged replies always go to a human.
6. **`SELLER_REPLY_RESTRICTION`** can target a seller (all members) or a user, is issued by an ADMIN who is not a
   member (COI), with step-up, and blocks create and edit.

## Alternatives considered

| Option | Why not |
|---|---|
| Links through an interstitial with `nofollow` | Still sends users off-platform from a trusted-looking "verified seller" block. More code (redirector, abuse handling) for little value at launch |
| Sanitised markdown | A sanitizer bug becomes stored XSS in front of staff and users (P-8). The value of formatting in a 1500-character reply is low |
| Separate `SellerReplyModerationCase` table | Duplicates the state machine, queue and staff tooling the review pipeline already has |
| Hard-reject phone numbers | Order and tracking numbers look like phone numbers. Human review handles that ambiguity better |

## Consequences

**Positive:** the main phishing channel (clickable links in a trusted block) does not exist. Moderation, staff queue
and audit are reused. Replies cannot outlive the seller's verification.

**Negative / risks:** obfuscated contact details ("brand dot com") rely on AI and human review. One non-additive
migration on `moderation_cases`. Sellers may find "no links" restrictive (M3b-Q8).

## Follow-ups

- M3b-07 implements it. QA: AZ-010 reply clause, RPL-001…RPL-013.
- T&S owns the soft-flag keyword list. Security owns the hard-rule corpus.
- M6: user reports on replies (`Report`), appeals on removed replies. M7: notify the reviewer of a reply.
