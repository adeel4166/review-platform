# ADR-0029: Trust score v1: a capped, decaying, explainable points model with gated bands; user score internal, bands public

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author, acting for Architect + Data per C-8). CEO (approval) |
| **Task** | #77 (M6–M8 spec) |
| **Related** | data-model §6.5 (inputs), open-questions C-8, T-9, L-15 · threat-model F-2, F-8 · [m6-m8-spec.md §15](../architecture/m6-m8-spec.md#15-trust-score-v1-adr-0029) · catalogue `TRS-001`, `TRS-005`, `TRS-008` |

## Context

The inputs and storage were fixed in M1 (data-model §6.5: `TrustSignal`, `TrustScoreSnapshot`, cached score); the
algorithm has had no owner (C-8, T-9). M7 needs bands for vote weighting (`TRS-001`), force-unsure rules
(`trustBands.NEW`), queue priority and the public seller band (wireframes 05, 06). F-8 asks for caps per signal,
decay, and a quick drop on bad behaviour.

## Decision

1. **Score** `S = clamp(BASE + Σ components, 0, 100)` with `BASE = 20`, computed by a pure function
   `scoreUser(inputs, clock)` / `scoreSeller(...)` in `packages/core/src/trust/score.ts`, versioned
   (`algorithmVersion = "trust-v1"`). Each component has a per-signal value, a cap and a half-life
   (`decay = 0.5^(age/halfLife)`). User components:

   | Component | Value | Cap | Half-life |
   |---|---|---|---|
   | Account age | `15 × min(ageDays / 90, 1)` | 15 | — |
   | Email verified / 2FA enabled | +5 / +5 | 10 | — |
   | `VERIFIED_PURCHASE` | +4 | +20 | 365 d |
   | `REVIEW_PUBLISHED` (review still `PUBLISHED`) | +2 | +20 | 365 d |
   | `HELPFUL_VOTE_RECEIVED` (daily, trust-weighted net) | +0.5 per weighted vote | +15 | 365 d |
   | `REPORT_UPHELD` / `REPORT_REJECTED` | +1 / −2 | +5 / −10 | 180 d |
   | `CONTENT_ACTIONED_AGAINST` | −10 | −40 | 180 d |
   | `ENFORCEMENT_ACTION` | WARNING −5, *_RESTRICTION −15, SUSPENSION −30 | −50 | 180 d |
   | `VELOCITY_ANOMALY`, `NEAR_DUPLICATE_TEXT` | −10 | −30 | 180 d |
   | `DUPLICATE_PROOF_DETECTED`, `PROOF_REJECTED_FRAUD`, `LINKED_ACCOUNT_SUSPECTED`, `MALWARE_UPLOAD` | −15 / −25 / −20 / −25 | −60 | 365 d |

   `APPEAL_OVERTURNED` **voids** the signal it overturns (`TrustSignal.voidedAt`); it is not a bonus.
   `HOLD_EXPIRED` rejections, `POST_REVIEW_LAPSED` and author deletions produce no negative signal (pipeline A-5).
2. **Bands** `NEW < LOW < MEDIUM < HIGH`. **NEW** whenever *any* maturity gate fails: account age < 7 d, email not
   verified, or fewer than 3 qualifying actions (published reviews + verified purchases + distinct days with a vote
   cast). Otherwise LOW < 40 ≤ MEDIUM < 70 ≤ HIGH. **Caps:** an active `POSTING_`/`VOTING_RESTRICTION` or
   `SUSPENSION` caps the band at LOW; any negative signal in the last 30 days caps it at MEDIUM (F-8 "sudden
   behaviour change lowers band").
3. **Seller score** (same function shape): `BASE 20`; verified seller +20; verified-claim age `10 × min(months/12,1)`;
   reply rate on the seller's products (last 90 d) `× 15`; verified share of published reviews `× 15`;
   `SELLER_REPLY_REMOVED` −5 (cap −20); `VELOCITY_ANOMALY` on its products −10 (cap −30); `SELLER_SUSPENSION` −40,
   `SELLER_REPLY_RESTRICTION` −15. Same bands, no NEW gate (an unverified seller is LOW at most).
4. **Visibility:** numeric scores are internal for users **and** sellers. The **band** is public on profiles and in
   comparison, with a plain-language explanation built from `TrustScoreSnapshot.components` (input names and
   direction only) and a public methodology page (L-15). Staff see score and components.
5. **Recompute:** debounced per subject (60 s) on a new signal, and nightly (`trust.nightly-decay`, 02:00 UTC).
   Each run writes a `TrustScoreSnapshot` (only when score or band changed) and updates the cached
   `User.trustScore/trustBand` and `Seller.trustScore/trustBand`. Deterministic: same signals + same clock → same
   result (`TRS-005`).

## Alternatives considered

| Option | Why not |
|---|---|
| ML model (gradient-boosted) | No labelled data pre-launch; not explainable as L-15 requires |
| Bayesian reputation (beta distribution on helpful/not-helpful) | Covers only votes; the inputs list is wider |
| Public numeric seller score | Invites disputes over single points (L-15 risk); the band carries the information wireframes need |

## Consequences

**Positive:** explainable, bounded, cheap to compute, tunable through constants with a version string.

**Negative / risks:** weights are judgement calls until three months of data exist. Changing them is a new
`algorithmVersion` and a full recompute (nightly job handles it).

## Follow-ups

- Data + T&S: calibrate after three months; publish the methodology page text (Legal review, L-15).
