# ADR-0030: Fake-review and vote defences: vote maturity and weights, velocity freezes in an `INTEGRITY` lane, MinHash near-duplicates, and product-burst routing with aggregate exclusion

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #77 (M6–M8 spec) |
| **Related** | ADR-0029 (bands) · threat-model F-1, F-2, F-3, F-9 · m4-m5-spec §2 (votes, weight 1 in M4) · [m6-m8-spec.md §16](../architecture/m6-m8-spec.md#16-votes-bursts-and-near-duplicates-adr-0030) · catalogue `TRS-001…004`, `TRS-007` |

## Context

M4 counts every vote with weight 1 and stores `ipHash`. F-1 (sock-puppet farms, review bombing) is Critical and F-2
(vote rings) High. The M7 gate requires `TRS-001` (NEW votes count 0 until maturity), `TRS-002` (velocity freeze),
`TRS-003` (near-duplicates across accounts) and `TRS-004` (bursts on one product go to a human and are excluded from
the aggregate until reviewed).

## Decision

1. **Vote weight at write time** (`ReviewVote.weight`, `DECIMAL(3,2)`): NEW 0, LOW 0.5, MEDIUM 1.0, HIGH 1.5, from
   the voter's band at the time of the vote. A nightly job re-weights votes whose voter left NEW (maturity is
   retroactive for the last 30 days, so a ring cannot pre-create accounts and vote once they mature with old votes
   already counted, but a genuine new user's early votes start counting when they mature). Public "helpful" count =
   number of votes with `weight > 0` and `frozen = false`; ranking uses the weighted sum. Raw counts are staff-only.
2. **Velocity freeze (`TRS-002`).** `trust.vote-anomaly` runs on each `vote.changed` event (debounced 30 s per review):
   flag when, within a sliding 60 min, a review gets more than `votes.freeze.perHour` (20) votes, or more than half of
   its last-24 h votes come from NEW/LOW voters, or ≥ 3 votes share one `ipHash`. Then `Review.votesFrozenAt` is set,
   later votes are stored with `frozen = true` (weight kept, not counted), displayed counts stay at the pre-freeze
   value, and an `INTEGRITY`-lane case (trigger `VOTE_ANOMALY`) opens. Staff **Release** (frozen votes count,
   unfreeze) or **Discard** (frozen votes get weight 0 permanently, voters get `VELOCITY_ANOMALY`, unfreeze). The
   content's `ContentStatus` never changes from an integrity case.
3. **Near-duplicates (`TRS-003`).** At submission and edit, `moderation.assess` computes a MinHash signature of the
   normalised text (lower-case, NFKC, punctuation stripped, digits → `0`, word 3-shingles, 128 hashes) and looks up
   LSH buckets (32 bands × 4 rows) in `review_lsh_buckets`. A candidate by a **different author** with estimated
   Jaccard ≥ `nearDuplicate.threshold` (0.5) is a hit: force-UNSURE (`reasonCode NEAR_DUPLICATE`) for content still
   in moderation, or a T11 RULE flag for live content; `NEAR_DUPLICATE_TEXT` signal on both authors. Texts shorter
   than 8 shingles use only the exact-hash rule. Same-author matches are ignored (a user's reviews of similar
   products).
4. **Product bursts (`TRS-004`).** A burst is more than `burst.perProductPerHour` (10) new reviews on one product in
   60 min, or more than `burst.lowTrustPerProductPerHour` (5) from NEW/LOW authors. While a burst is active (60 min
   after the last qualifying review): new reviews on that product are force-UNSURE (`PRODUCT_BURST`) and go to the HOLD
   lane; reviews of the burst window that were **already** published stay visible but get
   `Review.aggregateExcludedAt` and a priority bump on their `POST_REVIEW` case. A human confirm (T8) or approve (T5)
   clears the exclusion. A `VELOCITY_ANOMALY` signal is written for the product's seller (if any).
5. **Aggregates (`TRS-007`).** `catalog.aggregate` recomputes a product's `ratingAverage`, `ratingCount`,
   `verifiedRatingAverage`, `verifiedRatingCount` and a 5-bucket histogram **from scratch** with one SQL aggregate over
   `status = PUBLISHED AND aggregateExcludedAt IS NULL` (never incremental deltas), rounded half-even to 2 decimals.
   Triggered by any transition into or out of `PUBLISHED`, by exclusion changes and by label changes.

## Alternatives considered

| Option | Why not |
|---|---|
| Hide burst reviews that are already live | A burst can be a legitimate launch day; hiding without a human decision rewards review bombing (same reasoning as F-9) |
| Device fingerprinting | Privacy cost and consent questions (L-14); `ipHash` clustering is enough for Phase 1 |
| Embedding-based similarity via the AI provider | Sends text to a third party for a second purpose (L-6/M-6); MinHash runs locally and is explainable |
| Freeze by deleting suspicious votes | Irreversible; a release must be possible after review |

## Consequences

**Positive:** each defence is local, deterministic and has an explicit human exit.

**Negative / risks:** MinHash catches copies and light paraphrases, not full rewrites (residual F-1 risk). Thresholds
are placeholders until calibrated on real traffic; all are config values.

## Follow-ups

- QA: the `TRS-003` fixture set (20 copies/paraphrases over 5 accounts + unrelated controls) is the calibration set.
