# Open Questions: Phase 1 Architecture

| | |
|---|---|
| **Status** | Living document, opened by task #18 (M1.1), updated by #19, #24 (M1-T1), #44 (M3-01, §4), #54 (M3b-03, §5), #67 (M4-01, §6) and #77 (M6–M8 spec, §7) |
| **Owner** | Software Architect, who routes each question to the decision owner listed |
| **Rule** | A question moves to *Resolved* only with a named decision owner and a date. Resolutions that change the data model need a schema PR and an ADR update. |

Markers in [`schema.draft.prisma`](./schema.draft.prisma): `OPEN(LEGAL)` → §1, `OPEN(LANG)` → §2.

Every question below has a **working assumption**. Engineering builds to that assumption so it is not blocked,
and changes course if the answer differs. Each assumption is designed to be cheap to reverse.

---

## 0. For CEO review (task #24, M1-T1)

These need a CEO decision or a named owner and date. Each has a recommendation, and engineering proceeds on it until told otherwise.

| ID | Decision needed | Recommendation | Blocks |
|---|---|---|---|
| C-1 | **Approve ADR-0007 to ADR-0010.** These are the worker/outbox contract, verified-buyer approach, i18n readiness and table naming. Also confirm that ADR-0001 to ADR-0006 are recorded as *Accepted* (they were merged with approval of proposals #8 and #9) | Approve | M2 adoption of the schema into `packages/db` |
| C-2 | **Engage legal counsel.** All of §1 (L-1 to L-17) has been OPEN since task #18. Needs an owner and a date | Before M4 starts. L-5/L-6/L-7 (proof retention, legal basis, label after deletion) and L-2 (label wording) gate M4 | M4 proof, launch |
| C-3 | **Proof decisions: human-only vs. AI auto-verify** (ADR-0008 §4). Human-only means a staff decision for every proof | Human-only at launch, with `proof.autoVerify` reserved and off. Revisit after about 1,000 shadow-mode decisions show ≥ 99 % precision | Staffing plan, M4 |
| C-4 | **When to delete proof originals.** After the 30-day appeal window (data-model §6.2) or as soon as the redacted copy and the decision exist (threat model G-10)? | As soon as both exist (minimisation). Appeals use the redacted copy. Needs Legal confirmation (L-5) | M4 retention jobs |
| C-5 | **Launch languages and catalog translation** (G-1, G-5) | Confirm English-only and single-language catalog for Phase 1. ADR-0009 keeps adding a language cheap | None (confirmation) |
| C-6 | **Rating averages.** Plain average, or weighted by verification or trust (T-9)? | Plain average plus "verified share" and a "Verified only" filter in Phase 1. Weighting waits for the trust-score design | M4 product page |
| C-7 | **Staff capacity and SLAs.** Proof decisions in 3 days (ADR-0008), 100 % post-review in 24 h (T-11), appeals in 7 days / 72 h | Accept the targets for launch and size the moderation team against them. Set config levers before launch | Launch readiness |
| C-8 | **Owner and date for the trust-score algorithm** (T-9). Inputs and storage are fixed. The algorithm is unassigned, and seller scores are public (L-15) | Architect + Data, design doc before M7 | M7 trust |
| C-9 | **Hosting target** (T-1). Needed for the worker deployment groups (ADR-0007 §6) | Containers for web and worker (ADR-0001). DevOps to confirm in M2 | M2 deploy |

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
| L-9 | **Seller verification (KYB).** Is ownership proof enough, or do we need legal-entity verification (registration number, address, beneficial owner)? | Ownership proof only (DNS/meta/email/doc/marketplace). No KYB provider. **Taken as the M3 default in [ADR-0018](../adr/0018-kyb-ownership-proof-only.md)**; still needs Legal confirmation | Would add `SellerLegalEntity` table + KYB provider integration |
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
| G-2 | **UI i18n mechanism and URL strategy** (`/[locale]/...` prefix vs. cookie/header) | **Proposed in ADR-0009:** `next-intl`, no prefix while English-only, then `localePrefix: "as-needed"` so English URLs never change | None (routing concern) |
| G-3 | **User-content language.** Do we detect and store the language of reviews, and let users filter by it? | Detect during AI moderation and store in `Review.language` (BCP 47). Filtering is off at launch | Add `language` to `Post`/`Comment` if needed (additive) |
| G-4 | **Machine translation** of reviews ("Translate" button)? | Not in Phase 1 | Would add a `ReviewTranslation` cache table |
| G-5 | **Catalog translations.** Do product names, descriptions, categories and attribute labels need per-locale values? | No: single language | Would add `ProductTranslation`, `CategoryTranslation`, `CategoryAttributeTranslation` tables (base columns become the default locale) |
| G-6 | **Moderation quality per language.** What happens when AI moderation cannot reliably assess a language? | Content in a language the AI does not support always goes to `ESCALATE` → human | None (pipeline config) |
| G-7 | **Right-to-left (RTL) support** | Not at launch. Use Tailwind logical properties (`ms-`/`me-`) from day 1 so RTL is cheap later | None |
| G-8 | **Localised emails, notifications and legal texts** | English only. Templates rendered per `User.locale` / `User.timeZone` (ADR-0009) | Done in #24: `LegalAcceptance.documentLocale` and `EnforcementAction.publicReasonLocale` added |
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

## 4. M3: sellers, claims, email verification (task #44)

Opened by [m3-sellers-spec.md](./m3-sellers-spec.md). Engineering builds to the working assumption.

| ID | Question | Working assumption | Owner | Blocks |
|---|---|---|---|---|
| M3-Q1 | **2FA and step-up do not exist yet** (SEC-09(d), target M8), but ADR-0003 guard 3 needs 2FA for seller OWNER/MANAGER and the O-6 transfer mitigation needs it for both parties | M3a interim: password sign-in within 10 min for OWNER/MANAGER actions, behind `authz.sellerTwoFactorGate`. Full 2FA is a **launch blocker**. Recommend bringing TOTP forward to before M3b (needed for SEL-006) | CEO + Security | M3b, launch |
| M3-Q2 | **The ID `SEC-05` means two things.** In m2-security-review it is "registration enumeration". In m2-hardening-gate-report it is "AuditLog INSERT-only" (threat-model §10 checklist numbering) | This spec uses the m2-security-review meaning. QA to rename one series (e.g. `CHK-05` for checklist items) | QA | None |
| M3-Q3 | **M3 gate split** (ADR-0017): SEL-006 and the AZ-010 reply clause move to the M3b gate. Single-OWNER sellers until M3b. Recovery when the only OWNER loses access | Accept the split. Recovery = ADMIN procedure with audit and a verified-email check, documented in the M3-07 runbook | CEO + QA | M3a gate |
| M3-Q4 | DOCUMENT evidence formats | Images only (JPEG/PNG/WebP, re-encoded) in M3a. PDF needs a sandboxed rasteriser: later | Product + Security | None |
| M3-Q5 | Appeal of a claim rejection | No `Appeal` table until M6. M3a: re-submit with new evidence plus a support contact. `Appeal.ownershipClaimId` in M6 (L-3) | Product + Legal | M6 |
| M3-Q6 | **Contest policy:** 7-day incumbent response window, two ADMINs, the incumbent stays verified during the contest | As stated. Legal to confirm whether a lost contest needs a statement of reasons (DSA) | T&S + Legal | None |
| M3-Q7 | Upkeep of the PSL snapshot and the shared-host and free-mail deny-lists | Pinned in the repo, refreshed monthly by Dependabot. Security owns the local additions | Security + DevOps | None |
| M3-Q8 | Production mail provider (T-2), SPF/DKIM/DMARC, bounce handling | SMTP relay behind `MailProvider` until chosen. Mailpit is dev only | DevOps | Launch |
| M3-Q9 | **Password reset, email change and the unverified-account purge.** AUT-007 (reset) is not built. The draft `VerificationToken` purposes `PASSWORD_RESET`/`EMAIL_CHANGE` are unassigned. The 7-day purge hard-deletes contentless, never-verified users (an exception to "never hard-delete users") | Purge accepted (no user content exists). Recommend adding password reset to M3-03, or a follow-up task, with its own token purpose | Product + Security | A-2 completeness |
| M3-Q10 | Spot-check rates (10 % DNS/META, 25 % email) and the high-volume thresholds (50 product reviews, 500 brand reviews) | Config values. Calibrate after 3 months | T&S | None |
| M3-Q11 | Retention of ownership evidence, `seller_claim_decisions` and claim check fields (L-5) | Evidence: decision + 90 d (data-model §7). Decisions: kept as long as the claim row. Check fields: overwritten | Legal | None |
| M3-Q12 | Deferred seller fields: logo (`SELLER_LOGO` media), `trustScore`, `replyRate` | Added in M5/M7/M3b. Additive | Architect | None |
| M3-Q13 | Network policy for the `verification-egress` group depends on the hosting target (C-9/T-1). Optional egress proxy (Smokescreen-style) | In-app pinning is the primary control. DevOps writes the policy with the hosting decision. Proxy is optional in M8 | DevOps | Launch |
| M3-Q14 | Seller-verification queue: no lease columns, and contested claims are not `ModerationCase` rows | A filtered list at M3 volume. Revisit in M6 when `ModerationCase` gains its arc and leases | Architect | None |
| M3-Q15 | The composite FK `sellers(verifiedClaimId, id) → claims(id, sellerId)`. **Passed `prisma validate` on 6.19.3** (M3-01, full M3 plan merged into the real schema). Still to confirm: the generated MySQL DDL and the circular insert order in an integration test | If MySQL rejects it: a single-column FK plus service invariant plus consistency sweeper. SEL-011 tests are unchanged | Backend (M3-04) | None |
| M3-Q16 | Re-verification grace length (14 d) while the badge stays on | 14 d. Staff can revoke at once on a suspected takeover | Product + T&S | None |

---

## 5. M3b: 2FA, ownership transfer, business email, seller replies (task #54)

Opened by [m3b-spec.md](./m3b-spec.md). Engineering builds to the working assumption.

| ID | Question | Working assumption | Owner | Blocks |
|---|---|---|---|---|
| M3b-Q1 | **Auth.js stays, against ADR-0002's "no Auth.js".** The scaffold uses Auth.js JWT sessions. ADR-0019 adds a `UserSession` row behind the JWT instead of replacing Auth.js | Accept the hybrid for launch. Revisit when Google OIDC is built | CEO + Security | M3b-04 |
| M3b-Q2 | **Staff 2FA gate in M3b** (part of SEC-09(d), planned for M8) | On from M3b, no flag. Dev seeds enrol staff. Short staff sessions (2 h / 12 h) ship with it | CEO + Security | M3b-04 |
| M3b-Q3 | 2FA for seller `RESPONDER`s | Optional (ADR-0003). RESPONDERs can only reply, and replies are moderated. Revisit if reply abuse through stolen RESPONDER accounts appears | Product + Security | None |
| M3b-Q4 | **Lost device and lost recovery codes.** No self-service reset | Sellers: ADMIN recovery procedure (M3-Q3) with identity checks, audited. Staff: two-person runbook (ADR-0002). Four-eyes endpoint in M6 (AZ-024) | Security + Support | Launch |
| M3b-Q5 | Recovery-code use by a seller OWNER: alert only, or force re-enrolment like staff? | Alert only, and the UI asks to regenerate at ≤ 2 codes | Security | None |
| M3b-Q6 | Business mail on a subdomain (`jane@mail.brand.com`) | Refused (`subdomain_mailbox`). Subdomains may be delegated to third parties. Those sellers use DNS_TXT or DOCUMENT | Product + Security | None |
| M3b-Q7 | Role addresses (`info@`, `sales@` …) | Allowed, but always human-reviewed (`ROLE_ADDRESS`). Reserved local parts (`noreply@`, `abuse@` …) refused | T&S + Security | None |
| M3b-Q8 | Reply link policy | `none` at launch. `allowlist` (the seller's own verified domain, shown as text) reserved behind config | Product + T&S | None |
| M3b-Q9 | Telling the reviewer that a seller replied | Nothing in M3b. In-app notification with M7. No `seller_reply.published` event until it has a route | Product | None |
| M3b-Q10 | Users cannot report a reply until `Report` exists (M6) | Staff removal and post-review sampling cover the gap. Add a "report" link to the support form meanwhile | T&S | Launch (if M6 is later) |
| M3b-Q11 | Replies hidden when the seller is downgraded or loses the product; restored on re-verification | As stated (render-time rule). Legal to confirm no DSA statement of reasons is needed for this automatic hiding | Legal | None |
| M3b-Q12 | Ownership change: the target may accept at any time, execution waits for 72 h (refines ADR-0017 §4.6 "after 72 h, B accepts") | As stated (ADR-0020) | CEO | None |
| M3b-Q13 | Stalemate: an OWNER can cancel every `REMOVE_OWNER` against them. MANAGERs are not notified of ownership changes | ADMIN recovery procedure decides stalemates. Notify OWNERs and the target only | T&S + Support | None |
| M3b-Q14 | TOTP algorithm and window | SHA-1, 6 digits, 30 s, ±1 step, for compatibility with common authenticator apps | Security | None |
| M3b-Q15 | Session cookie name. ADR-0002 and AUT-012 expect `__Host-`; Auth.js defaults to `__Secure-authjs.session-token` | Backend checks the current config in M3b-04 and sets a `__Host-` name through Auth.js `cookies` options if possible; otherwise QA updates AUT-012 | Backend + QA | M3b-09 |
| M3b-Q16 | A `SELLER_REPLY_RESTRICTION` blocks new replies and edits. Should it also hide published replies? | No. Staff remove harmful replies one by one | T&S | None |

M3b-Q10 (users cannot report replies) is closed by [m4-m5-spec.md §4](./m4-m5-spec.md#4-reporting-reviews-and-seller-replies): M4 adds reports for seller replies.

---

## 6. M4 + M5: votes, edits, reports, proof, media (task #67)

Opened by [m4-m5-spec.md](./m4-m5-spec.md). Every item has a **default decision**. Engineering builds to it, and it
stays in force unless the owner changes it.

| ID | Question | Default decision | Owner | Blocks |
|---|---|---|---|---|
| M45-Q1 | Where do report cases live before the M6 lanes? | On `ModerationCase`, with `trigger = USER_REPORT`, `seq` and a nullable unique `openReportKey` (spec §4.3). A separate table and a nullable `version` were rejected | Architect | M4-04 |
| M45-Q2 | Catalogue cases that cannot pass in their milestone | QA moves or splits them: MOD-019 and E2E-001 `POST_REVIEW` clause → M6; E2E-010 → M5 (no public bucket in M4); AZ-014 → M7 (no blocks, comments, likes or follows in M4); MED-027 wording (rejection in `media.scan`, ADR-0023). New ids per spec §13.3–§13.7 | QA | M4/M5 gates |
| M45-Q3 | Edits of `REJECTED`/`REMOVED` reviews (lifecycle T20) | Refused in M4 (`not_editable`, ADR-0003). T20 ships with M6 appeals | Product + T&S | None |
| M45-Q4 | Is revision history public? | No. Public "Edited" marker with date only. Author and staff see the history | Product + Legal | None |
| M45-Q5 | Do votes reset when a review is edited? | No. Votes are kept, including on a rating change | Product | None |
| M45-Q6 | NEW band before M7 trust bands | Account age < 7 days (`VOTE_NEW_ACCOUNT_DAYS`). Used for vote limits and report weight | Architect + Data | None |
| M45-Q7 | When to delete proof originals (C-4) | At decision (`PROOF_ORIGINAL_RETENTION=AT_DECISION`). `APPEAL_WINDOW` (30 d) is a config switch | Legal (L-5) | Launch |
| M45-Q8 | OCR/redaction engine (T-5) | In-house Tesseract in the sandboxed `media` group. Only redacted pages go to the AI extractor ([ADR-0022](../adr/0022-in-house-proof-redaction.md)) | Architect + Legal (L-6) | None |
| M45-Q9 | HMAC key for `orderReferenceHash` in the `media` group | Yes (ADR-0022). The threat-model secrets table is updated by Security | Security | M4-05 |
| M45-Q10 | A proof whose files are all rejected | `EXPIRED (NO_VALID_FILES)`, not `REJECTED`; not an attempt; the user may resubmit (no automatic rejection, ADR-0008 §4) | T&S | None |
| M45-Q11 | New proof after a label revocation | Refused while the `VERIFIED_LABEL_REVOKED` action is `ACTIVE` (`label_revoked`). The path back is an appeal (M6) | T&S | None |
| M45-Q12 | Staff access to proof originals in M4 | None. The break-glass `proof.view_original` (PRV-003) ships in M6. Until then, decisions use the redacted copy only | Security + T&S | None |
| M45-Q13 | R2 token granularity vs INF-002 (no web GET on ingest) | Confirm drops `HEAD` ([ADR-0023](../adr/0023-ingest-least-privilege-and-publication-gate.md)). If R2 cannot issue a write-only token, accept the residual with INF-006 and short-lived ingest objects. Spike in M5-01 | DevOps + Security | Launch |
| M45-Q14 | ClamAV signatures stale | Above 24 h: alert and worker health 503, scans continue (media is re-encoded). Above 72 h: scans fail closed | Security + DevOps | None |
| M45-Q15 | Where exiftool runs | Only on our own outputs, as the verification gate. Detection of metadata in originals uses sharp and ffprobe (exiftool has a parser CVE history) | Security | None |
| M45-Q16 | Parser sandbox mechanism | `bwrap` + `prlimit` per child process, custom seccomp profile, read-only root fs. Production and CI refuse to start without it | DevOps + Security | M5-02 |
| M45-Q17 | HEIC (MD-1, T-13) | Accepted only if the worker's libvips has libheif. Otherwise refused at the slot with clear copy. MED-004 stays P1 | DevOps | None |
| M45-Q18 | Video moderation frames | Not extracted in M5 (no AI image moderation yet). Staff see the poster and the private video | T&S | None |
| M45-Q19 | Upload quotas differ: code 20/h + 50/24 h, threat-model §5 60/h + 300/day | Keep the stricter code defaults (config). QA aligns SEC-004 to the configured values | Product + QA | None |
| M45-Q20 | Notifications before the M7 inbox | Email only, for mandatory types (`CONTENT_REMOVED`, `MEDIA_REJECTED`, `PROOF_*`, `VERIFIED_LABEL_REVOKED`). Reporters see status in "My reports" | Product | None |
| M45-Q21 | The relay marks unrouted events as published (contradicts ADR-0007 §3) | Not changed in M4/M5. New OUT-008 test: every emitted type has a route. Fail-loud relay behaviour with the M6 DLQ work | Backend | None |
| M45-Q22 | Label wording and the public methodology page (L-2) | "Verified purchase · receipt / order confirmation / marketplace order" with a methodology link. Legal reviews the copy before launch | Legal + Product | Launch |

---

## 7. M6–M8: moderation, trust, social, hardening (task #77)

Opened by [m6-m8-spec.md](./m6-m8-spec.md). Every item has a **default decision**. Engineering builds to it, and it
stays in force unless the owner changes it.

| ID | Question | Default decision | Owner | Blocks |
|---|---|---|---|---|
| M68-Q1 | `AIF-001` says back-off 5 s / 20 s / 60 s with "up to 3 attempts"; job-catalogue §3.2 says 3 attempts use only two back-offs | Job-catalogue wins (5 s, 20 s). QA rewords `AIF-001` ([ADR-0028](../adr/0028-ai-verdict-contract-and-injection-canaries.md) §4) | QA | M6 gate |
| M68-Q2 | `CLS-010` ("> 20 reviews per hour from one **account**") conflicts with pipeline §5.3 (extreme rating and the **product** received > 20 reviews in the last hour); accounts are capped at 5 reviews/day | Pipeline wins. QA rewords `CLS-010` | QA | M6 gate |
| M68-Q3 | `AZ-017` (system principal never SUSPENSION) vs `CLS-012` (zero tolerance → account SUSPENDED) and the strike ladder | One narrow exception: protective `SUSPENSION (ZERO_TOLERANCE_HOLD)` only for zero-tolerance verdicts; ladder restrictions by the system; BAN never ([ADR-0025](../adr/0025-moderation-engine-baseline-for-m6.md) §3). QA rewords `AZ-017` | CEO + QA | M6 gate |
| M68-Q4 | QA §9.11 (report threshold vs F-9) and `MOD-012` text | Resolved by ADR-0011 (count never hides; T15 needs AI violation or staff). QA rewrites `MOD-012` and marks §9.11 resolved | QA | M6 gate |
| M68-Q5 | Server-side test clock for E2E (test-strategy §3, §10 item 4) | **No runtime hook in any build.** E2E seeds past deadlines and uses a short sweep interval ([ADR-0024](../adr/0024-clock-interface-and-no-runtime-test-clock.md)) | Architect + QA | M6 E2E |
| M68-Q6 | Second approval for large bulk rejects/removals (threat MT-3) | Not in M6. Bulk capped at 100, reject/remove SMOD-only, per-staff anomaly alert (`SEC-012`). Revisit after launch data | T&S + Security | None |
| M68-Q7 | Are vote-freeze (`INTEGRITY`) decisions appealable or notified? | No: they do not act on content or accounts. A `Discard` that adds `VELOCITY_ANOMALY` affects trust only. Legal to confirm no statement of reasons is needed | Legal | None |
| M68-Q8 | Break-glass under the default `AT_DECISION` proof retention only works before a decision | Accepted (minimisation, C-4). Appeals use the redacted copy ([ADR-0027](../adr/0027-break-glass-original-proof-access.md)) | Security + Legal | None |
| M68-Q9 | Trust weights and band thresholds (C-8, T-9) | [ADR-0029](../adr/0029-trust-score-v1.md) v1. Bands public (users and sellers), numbers internal. Calibrate after 3 months | Data + T&S, Legal (L-15) | None |
| M68-Q10 | Retroactive re-weighting window when a voter matures | 30 days ([ADR-0030](../adr/0030-fake-review-and-vote-defences.md) §1) | Data | None |
| M68-Q11 | Comparison rows "price range" and "pros/cons themes" (wireframe 05) | Not shown in Phase 1: no price data, no theme extraction job | Product | None |
| M68-Q12 | Comments, posts, likes, wishlist, saved comparisons | Deferred to Phase 1.x ([ADR-0032](../adr/0032-m7-social-and-comparison-scope.md)). Permissions and moderation types stay | Product | None |
| M68-Q13 | Mandatory notification list (includes `PROOF_*`, `VERIFIED_LABEL_REVOKED`, `ENFORCEMENT_ISSUED`) | As [ADR-0031](../adr/0031-notification-inbox-and-mandatory-types.md) §2 | Legal (L-2) | Launch |
| M68-Q14 | Erasure semantics and tombstone hash retention | Anonymise reviews (L-4), purge proofs and media, null tombstone hashes 12 months after purge ([ADR-0033](../adr/0033-erasure-retention-and-deletion-ledger.md)) | Legal (L-4, L-5) | Launch |
| M68-Q15 | Object-lock bucket for the deletion ledger and the audit archive | `rp-ledger` and `rp-audit-archive` with object lock (R2/S3; MinIO in dev) | DevOps | M8 |
| M68-Q16 | Pen-test vendor, window, staging environment with the production build | Vendor chosen by the CEO; staging per m6-m8-spec §24 | CEO + Security | Launch |
| M68-Q17 | M5 gate gaps that M6 depends on (`MED-030` media wait, `MED-012` parent effects) | Built inside M6-B (m6-m8-spec §0.4). Other M5 gaps stay with the M5 fix task | PM | M6 |
| M68-Q18 | About 85 `new Date()`/`Date.now()` call sites | M6 migrates moderation, appeal and timer paths (lint error there); M8 migrates the rest (`OPS-008`) | Backend | M8 |
| M68-Q19 | Appeal reviewer pool: A2 excludes human deciders, and major-enforcement overturns need two SMODs | Ops staffs at least three SENIOR_MODERATORs before launch (extends strategy §9.8) | T&S | Launch |
| M68-Q20 | New staff screens without wireframes: Approvals, Integrity lane, break-glass dialog, config diff | Follow wireframe 07 patterns; Design adds them to 07 during M6-C | Design | None |

Items from earlier sections that this spec closes or schedules: **LC-1** (no `APPEAL` trigger is added; ADR-0025
§5), **LC-2** (`timers.reportedSlaHours` = 48, config), **LC-3** (T20 allowed, force-UNSURE after a human decision),
**M3-Q5** (appeal of a claim rejection via `Appeal.ownershipClaimId`, spec §10.1), **M3-Q14** (claims stay a filtered
list; leases only on cases and appeals), **M3b-Q4** (four-eyes 2FA reset endpoint, ADR-0026), **M3b-Q9**
(`SELLER_REPLIED` in-app, spec §17), **M45-Q3** (T20 ships in M6), **M45-Q11** (appeal path for label revocations),
**M45-Q12** (break-glass, ADR-0027), **M45-Q21** (relay fail-loud, spec §13.1), **C-8** (trust algorithm owner and
design: ADR-0029, pending CEO approval). They move to *Resolved* when the CEO approves this spec.

---

## Resolved

_None yet._
