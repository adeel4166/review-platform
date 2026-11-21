# ADR-0018: Seller verification is ownership proof only (no KYB) for Phase 1

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval). Legal to confirm L-9 |
| **Task** | #44 (M3-01) |
| **Related** | open-questions L-9 (default taken here), L-1/L-2, ADR-0014, [m3-sellers-spec.md §4.1](../architecture/m3-sellers-spec.md) |

## Context

L-9 asks whether seller verification needs know-your-business (KYB) checks: legal entity, registration number,
address, beneficial owner. Its working assumption is "ownership proof only". M3 must decide what "Verified" means so
the badge copy, schema and staff workload are fixed. The platform is a review site. It does not sell goods or take
payments for sellers.

## Decision

1. **"Verified" means proven control** of a domain, business mailbox, marketplace store or brand documents
   (ADR-0014). It does **not** mean a verified legal entity.
2. No KYB provider, no `SellerLegalEntity` table, no registration-number, address or UBO fields.
   `Seller.countryCode` is optional and self-declared.
3. The badge and copy say "Verified: example.com" or "Verified owner". Never "verified business" or "verified
   company".
4. DOCUMENT evidence may include registration papers, but they are used only as ownership evidence and are retained
   under the evidence retention rule (decision + 90 days).

## Alternatives considered

| Option | Why not |
|---|---|
| KYB through a provider for every seller | Cost per check, onboarding friction and more personal data (UBO). No requirement for a review site, unless Legal says otherwise |
| KYB only for high-volume brands | Useful later. Additive: a `SellerLegalEntity` table and a provider behind an interface |

## Consequences

**Positive:** No extra personal data, faster onboarding, no vendor dependency.

**Negative / risks:** The badge does not guarantee who the legal entity is. If Legal answers L-9 differently (for
example if DSA trader-traceability or a payment feature applies), we add KYB later. That is additive and needs no
change to claims.

## Follow-ups

- Legal: confirm L-9 before launch (C-2).
- Design: badge and tooltip copy match decision 3.
