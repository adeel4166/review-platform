# Open Questions: Phase 1 Architecture

| | |
|---|---|
| **Status** | Living document, opened by task #18 (M1.1) |
| **Owner** | Software Architect, who routes each question to the decision owner listed |
| **Rule** | A question moves to *Resolved* only with a named decision owner and a date. Resolutions that change the data model need a schema PR and an ADR update. |

Markers in [`schema.draft.prisma`](./schema.draft.prisma): `OPEN(LEGAL)` → §1, `OPEN(LANG)` → §2.

Every question below has a **working assumption**. Engineering builds to that assumption so it is not blocked,
and changes course if the answer differs. Each assumption is designed to be cheap to reverse.

---

## 1. Legal: OPEN

> **Status: OPEN. Needs legal counsel.** Nothing in this section has been reviewed by a lawyer.
> These are architecture-level questions and the working assumptions are not legal advice.

| ID | Question | Working assumption (until resolved) | Model impact if answer differs |
|---|---|---|---|
| L-1 | **Launch jurisdictions and governing law.** Which countries/regions are we launching in (EU, UK, US, others)? | Design to the strictest plausible set (EU GDPR + DSA, UK, US FTC) | Low. The model already supports the strict case |
| L-2 | **Applicable regimes.** Which of these apply: GDPR / UK GDPR; CCPA/CPRA; EU Digital Services Act (notice-and-action, statement of reasons, internal complaint handling, trusted flaggers, transparency reports); EU consumer law (disclose whether and how reviews are verified); US FTC rule on consumer reviews and testimonials (16 CFR Part 465: fake reviews, review suppression, insider and incentivised reviews); UK DMCC Act (fake reviews)? | All apply. Model provides: `EnforcementAction.publicReason` (statement of reasons), `Appeal` (complaint handling), `Report` (notice-and-action), `AuditLog` (transparency reporting source), `Review.incentive`, verification method on reviews | Transparency-report aggregates may need extra reporting fields on `ModerationCase` (e.g. "detected by automated means"). Partly covered by `ModerationDecision.source` |
| L-3 | **Who may appeal?** Only the person whose content or account was actioned, or also the reporter when we decide "no action"? | Both. `Appeal.appellantId` can be any user, with one appeal per appellant per decision | None |
| L-4 | **Erasure vs. reviews.** When a user deletes their account, do we remove their reviews or keep them anonymized as "Former user"? | Anonymize: keep review text and rating, unlink identity, purge proofs/media. The user can delete individual reviews before deleting the account | If "remove": the erasure job soft-deletes reviews instead. No schema change |
| L-5 | **Retention periods** for proof originals and redacted copies, ownership evidence, soft-deleted content, moderation snapshots, audit logs, IP hashes, sessions | Proposed defaults in [data-model.md §7](./data-model.md#7-retention-proposed-defaults-all-pending-legal-open) | Config values only |
| L-6 | **Purchase-proof processing.** What is our legal basis, do we need a DPIA, which processors may see receipts (OCR/AI provider, storage region), and how are cross-border transfers handled? | Consent at upload, DPIA before launch, EU-region storage for EU users, processors under DPA, no model training on proofs | May force self-hosted OCR/redaction (see T-5) and region-pinned buckets |
| L-7 | **Verified label after proof deletion.** If a user deletes their proof after it was verified, may the "Verified buyer" label stay, based on our retained attestation record? | Yes: the label stays and the minimal `PurchaseProof` row is the provenance record | If no: the deletion job also clears `Review.verifiedPurchaseAt`. No schema change |
| L-8 | **Incentivised and insider reviews.** Which incentives are allowed and how must they be labelled? Must seller employees and relatives be banned from reviewing? | Allowed with mandatory disclosure (`Review.incentive`). Seller members are blocked from reviewing their own products. Paid reviews are banned by content policy | Enum values / label copy only |
| L-9 | **Seller verification (KYB).** Is ownership proof enough, or do we need legal-entity verification (registration number, address, beneficial owner)? | Ownership proof only (DNS/meta/email/doc/marketplace). No KYB provider | Would add `SellerLegalEntity` table + KYB provider integration |
| L-10 | **Minimum age and age assurance** (13 / 16 / 18) | Users declare 16+ at signup via `LegalAcceptance` of terms. No birthdate is stored | Possible `ageConfirmedAt` field or an age-assurance provider |
| L-11 | **IP address handling.** Is storing keyed-hash IPs for abuse prevention and audit acceptable, and for how long? | Keyed hash (`ipHash`), 90 days. Raw IPs only in short-lived infrastructure logs | None (column already nullable) |
| L-12 | **Third-party legal notices.** How do we handle defamation and IP takedown requests from sellers or third parties, DMCA-style agent designation, and requests from authorities? | Handled as `Report` (reason `INTELLECTUAL_PROPERTY` / `ILLEGAL_CONTENT`) by ADMIN. `MediaAsset.legalHold` for preservation | May need a dedicated `LegalRequest` entity with requester identity |
| L-13 | **Legal documents.** Who owns the Terms, Privacy Policy, Content Policy and Seller Terms? How are they versioned, and when must users re-consent? | `LegalAcceptance` per document version. Re-consent is prompted at login after a material change | None |
| L-14 | **Cookies and analytics consent** | Strictly-necessary cookies only (session, CSRF). Analytics are off until a consent solution is chosen | None in the DB |
| L-16 | **Auto-rejection without human review.** Is rejecting content automatically when the 7-day hold expires (no human looked at it) acceptable, and what must the statement of reasons say? (M1.2) | Acceptable when the notice says "not reviewed in time", the appeal is decided by a human within 72 h, and no strike or trust penalty is applied | Copy and SLA config only |
| L-17 | **CSAM / terrorist content.** Must we use an industry hash-matching service and report to authorities (e.g. NCMEC / national bodies)? (M1.2) | Zero-tolerance categories suspend the account, escalate to SENIOR_MODERATOR and set `legalHold`. Hash-matching integration recommended before launch | Adds a hash-matching provider to the media VALIDATE step |
| L-15 | **Public seller trust score.** Is there defamation or unfair-practice risk in publishing it, and must we disclose the methodology? | Public, with a published high-level methodology and an appeal path via `Appeal` | None |

---

## 2. Language / localisation: OPEN

> **Status: OPEN. Needs Product decision.** The Phase 1 model is **single-language for catalog data** and
> only records the language of user content.

| ID | Question | Working assumption | Model impact if answer differs |
|---|---|---|---|
| G-1 | **Launch languages and default locale** | English only at launch. All strings are externalised from day 1 so more languages can be added later | None |
| G-2 | **UI i18n mechanism and URL strategy** (`/[locale]/...` prefix vs. cookie/header) | Use `next-intl`. Use a locale prefix only once a second language ships | None (routing concern) |
| G-3 | **User-content language.** Do we detect and store the language of reviews, and let users filter by it? | Detect during AI moderation and store in `Review.language` (BCP 47). Filtering is off at launch | Add `language` to `Post`/`Comment` if needed (additive) |
| G-4 | **Machine translation** of reviews ("Translate" button)? | Not in Phase 1 | Would add a `ReviewTranslation` cache table |
| G-5 | **Catalog translations.** Do product names, descriptions, categories and attribute labels need per-locale values? | No: single language | Would add `ProductTranslation`, `CategoryTranslation`, `CategoryAttributeTranslation` tables (base columns become the default locale) |
| G-6 | **Moderation quality per language.** What happens when AI moderation cannot reliably assess a language? | Content in a language the AI does not support always goes to `ESCALATE` → human | None (pipeline config) |
| G-7 | **Right-to-left (RTL) support** | Not at launch. Use Tailwind logical properties (`ms-`/`me-`) from day 1 so RTL is cheap later | None |
| G-8 | **Localised emails, notifications and legal texts** | English only. Templates keyed by `User.locale` | `LegalAcceptance` may need a `language` column |
| G-9 | **Units and number formats in comparisons** (metric/imperial, decimal separators) | Store canonical SI values in `Product.specs`. Format at render time using the locale | None |

---

## 3. Technical / product (non-blocking)

| ID | Question | Working assumption | Owner |
|---|---|---|---|
| T-1 | Hosting target: containers vs. Vercel (web) + a separate worker host | Containers for both web and worker (ADR-0001). The web app stays Vercel-compatible | DevOps |
| T-2 | Transactional email provider | Any provider with SPF/DKIM/DMARC support and bounce webhooks. Selected in the scaffold task | DevOps |
| T-3 | Search: MySQL FULLTEXT vs. an external engine (Meilisearch / OpenSearch) | MySQL FULLTEXT on `Product(name, brandName)` for Phase 1, kept behind a `SearchService` interface | Architect |
| T-4 | AI moderation provider, policy taxonomy and auto-action thresholds | **Pipeline, taxonomy and configurable thresholds defined in M1.2** ([moderation-pipeline.md](./moderation-pipeline.md)). Provider choice and threshold calibration are still open: provider spike behind the `ModerationProvider` interface, then shadow-mode calibration | Architect + T&S |
| T-5 | OCR/PII-redaction engine for proofs (cloud API vs. self-hosted) | Behind a `ProofRedactor` interface. The choice depends on L-6 | Architect |
| T-6 | Apple sign-in and passkeys in Phase 1? | Google OAuth at launch. Passkeys are a stretch goal (table already reserved). Apple is deferred | Product |
| T-7 | Seller-issued review invitations (verified via order-bound links) | Phase 1.x. Would add a `ReviewInvitation` table and a `SELLER_INVITATION` proof method | Product |
| T-8 | Reviews of sellers/stores in addition to products? | Product reviews only. Seller reputation comes from product reviews + reply behaviour | Product |
| T-9 | Trust score algorithm (weights, decay, bands) | Separate design doc. The inputs are fixed in data-model.md §6.5 | Architect + Data |
| T-11 | **Post-review staffing.** 100 % human post-review of CLEAN content within 24 h scales linearly with volume | 100 % at launch; `postReview.sampleRate` per trust band is the lever | Product + T&S |
| T-12 | Video transcoding: self-run ffmpeg worker vs. managed service (Cloudflare Stream, Mux) | Self-run ffmpeg in a separate `media-video` deployment (ADR-0006), swappable behind the `media.transcode` job | Architect + DevOps |
| T-13 | HEIC photo support needs libvips built with libheif in the worker image | Supported; fallback is rejecting HEIC and relying on iOS Safari's JPEG conversion | DevOps |
| T-10 | Managed MySQL flavour (RDS / Aurora / Cloud SQL / PlanetScale) | Any MySQL 8.0.16+ with real FK and CHECK enforcement. Vitess-based offerings must be verified for FK/CHECK support first | DevOps |

---

## Resolved

_None yet._
