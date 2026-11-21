# Threat Model: Phase 1 (M1 designs)

| | |
|---|---|
| **Status** | Draft for review (task #20, milestone M1.3); extended by task #26 (M1-T3): see §9 (appeals, secrets, tokens) and §10 (M2 checklist) |
| **Author** | Security Engineer |
| **Method** | STRIDE per asset/trust boundary, ranked by likelihood x impact |
| **Inputs** | ADR-0002 (auth/2FA), ADR-0003 (permissions), ADR-0005 (moderation), ADR-0006 + [media-pipeline.md](../architecture/media-pipeline.md), [data-model.md](../architecture/data-model.md) §6, [moderation-pipeline.md](../architecture/moderation-pipeline.md) |
| **Scope** | Design-level review of documents. No code exists yet. Nothing here was tested against a running system. |

## 0. Assumptions

- **Milestone mapping (assumed).** The repo does not define M2-M8. This document assumes:
  **M2** identity & auth (sessions, 2FA, authz, rate-limit layer) · **M3** catalog, sellers & ownership proof · **M4** reviews, votes & verified-buyer proof ·
  **M5** media upload/processing · **M6** moderation pipeline, staff console, enforcement/appeals · **M7** trust scores, social, comparison, notifications ·
  **M8** hardening, pre-launch security review, ops runbooks, privacy/retention jobs. If the PM plan differs, re-map the "Milestone" column only.
- Legal questions (L-1..L-17) are open. Mitigations that depend on them are flagged `OPEN(LEGAL)`.
- Attackers considered: anonymous internet user; registered malicious user (incl. sock-puppet rings); malicious/competing seller; compromised user or staff account; malicious or coerced insider (staff); curious DB/bucket reader (leaked backup, over-broad credential); abused third party (AI provider, URL fetched by worker).
- Out of scope: infrastructure/cloud-account security beyond what designs state, Phase 2 messaging, DDoS volumetric defence (handled at CDN/WAF; noted in §10).

## 1. Assets and trust boundaries

| Asset | Why it matters | Where |
|---|---|---|
| Staff & seller-OWNER/MANAGER sessions | Can remove content, reply as a brand, view receipts | `Session`, `UserRole`, `SellerMember` |
| Purchase proof originals (receipts) | Full PII (name, address, partial card, order no.) | private bucket, `PurchaseProof`, `MediaAsset` |
| Ownership evidence documents | Business PII | private bucket |
| Review integrity (ratings, verified label, trust scores) | The product's value | `Review`, `ReviewVote`, `TrustSignal` |
| Moderation config & decisions | Controls what is published | `ModerationConfig`, `ModerationDecision` |
| Audit log | Non-repudiation | `AuditLog` |
| Secrets: TOTP encryption key, `orderReferenceHash` HMAC key, ipHash key, R2 tokens, AI provider key | Compromise breaks several mitigations at once | secrets manager |

Trust boundaries: **TB1** browser <-> Next.js; **TB2** browser -> object storage (presigned PUT); **TB3** web <-> DB/Redis; **TB4** worker <-> untrusted bytes (libvips/ffmpeg/OCR); **TB5** worker -> external (AI provider, seller website fetch, DNS, email); **TB6** staff console <-> platform; **TB7** public CDN/media host <-> app origin.

## 2. Risk rating

Likelihood (L) and Impact (I) are 1-3; Risk = L x I. **Critical** >= 8, **High** 6, **Medium** 3-4, **Low** <= 2.
Priority drives milestone ordering: Critical/High mitigations must land in the milestone named, with tests, before that feature is enabled.

## 3. Threat list (STRIDE)

Legend: **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of service, **E**levation of privilege.
"Design status" = how well the current M1 design already covers it: **Covered**, **Partial**, **Gap** (needs a design change, see §4).

### 3.1 Authentication, sessions, 2FA (ADR-0002)

| ID | STRIDE | Threat | L | I | Risk | Existing design | Status | Mitigation / required control | Milestone |
|---|---|---|---|---|---|---|---|---|---|
| A-1 | S | Credential stuffing / brute force on login and TOTP | 3 | 3 | **Crit** | Redis sliding window per IP + identifier, CAPTCHA, no lockout | Partial | Per-account limiter must also cover the pending-2FA step with a **per-session attempt cap (e.g. 5)** that kills the pending session; TOTP verify limited per account across sessions. Breached-password check. Alert on spikes | M2 |
| A-2 | S | Account takeover via OAuth pre-account takeover / unsafe linking | 2 | 3 | High | Link only if Google email verified **and** control proven | Covered | Test: attacker pre-registers victim email with password -> victim later signs in with Google must not inherit attacker's credentials. Unverified-email accounts cannot hold content; on first Google link **revoke all existing sessions and require password reset if the account was never email-verified** | M2 |
| A-3 | S | Session theft (XSS, malware, token leak in logs) | 2 | 3 | High | `__Host-` HttpOnly cookie, hashed token, rotation, short staff TTL | Covered | Strict CSP (nonce) from scaffold, no tokens in URLs/logs/Sentry (log scrubber test). Staff sessions: optional IP/UA-change soft check that forces step-up (not hard bind) | M2 / M8 |
| A-4 | S | Session fixation | 1 | 3 | Low | Rotation on login/privilege change/2FA | Covered | Test coverage only | M2 |
| A-5 | E | 2FA bypass: pending session reaching other endpoints; role active without 2FA | 2 | 3 | High | `secondFactorPending` limited endpoint; authz 2FA gate | Covered | Single middleware default-deny for pending sessions. Test every route/action with a pending session. Worker jobs acting for user re-check gate | M2 |
| A-6 | S | TOTP replay / enrolment race | 2 | 2 | Medium | `lastUsedStep` | Covered | Enrolment must be confirmed with a valid code before `enabled`; secret shown once; rate-limited | M2 |
| A-7 | E | Recovery-code abuse (only 50-bit codes, SHA-256) | 2 | 3 | High | Codes >= 50 bits, hashed, alert on use | Partial | Recovery code verification shares the TOTP attempt limiter. Use HMAC with server key (or Argon2id) rather than bare SHA-256 so DB leak can't be brute-forced offline at 2^50. Recovery use for **staff** requires another staff alert + forces re-enrolment | M2 |
| A-8 | S | Account recovery abuse (email takeover -> password reset -> 2FA disabled) | 2 | 3 | High | Step-up for 2FA disable; 2FA reset requires two staff | Partial | Password reset must **not** disable 2FA or skip it. Reset token single-use, 30 min, hashed; revoke sessions; notify old email on email change with 24-48 h revert link | M2 |
| A-9 | I | User/account enumeration via login, reset, signup, timing | 3 | 1 | Medium | Same response for unknown/wrong | Partial | Signup must also be non-enumerating ("check your email"). Equalise timing (dummy Argon2 verify for unknown email) | M2 |
| A-10 | T | CSRF on Route Handlers, login CSRF | 2 | 2 | Medium | Origin check, SameSite=Lax | Covered | Central `assertSameOrigin` for all non-GET handlers; test missing/`null` Origin. Reject mutating requests lacking Origin and Sec-Fetch-Site same-origin | M2 |
| A-11 | D | Argon2id cost used as CPU DoS (many login attempts) | 2 | 2 | Medium | Rate limit | Partial | Rate-limit *before* hashing; cap concurrent hashes; CAPTCHA threshold | M2 |
| A-12 | R | Missing audit of auth events or log tampering | 1 | 2 | Low | `AuditLog` | Covered | Audit rows append-only (DB user without UPDATE/DELETE on `AuditLog`); see S-4 | M2 / M8 |
| A-13 | S | Open redirect after login / OAuth callback | 2 | 2 | Medium | Not specified | **Gap** | Allow-list relative `returnTo` paths only; exact-match OAuth redirect URIs | M2 |
| A-14 | I | TOTP encryption key compromise / loss | 1 | 3 | Medium | AES-256-GCM, `keyId` | Partial | Key in secrets manager, **not in the same store as DB backups**; documented rotation and re-encryption job; key-loss runbook | M2 / M8 |

### 3.2 Authorization and admin privilege abuse (ADR-0003)

| ID | STRIDE | Threat | L | I | Risk | Existing design | Status | Mitigation / required control | Milestone |
|---|---|---|---|---|---|---|---|---|---|
| P-1 | E | Missing `assertAuthorized` on an action/route/job (IDOR, BOLA) | 3 | 3 | **Crit** | Central `authorize()`, "every action calls it" | Partial | Enforce mechanically: wrapper `defineAction()` that cannot be built without a permission; lint/CI rule banning bare Server Actions and direct Prisma in routes/components; integration test that enumerates routes and fails on any not registered. Resource lookups scoped by owner (no raw `findUnique(id)`) | M2 (framework), every milestone (per feature) |
| P-2 | E | Cross-seller access (RESPONDER of seller A acts on seller B; product-ownership check skipped) | 2 | 3 | High | Resource-scoped seller role | Covered | Table-driven cross-seller tests per permission; scope derived from the **resource**, never from client-supplied `sellerId` | M3 / M4 |
| P-3 | E | Privilege escalation by self-grant or by chained grants (ADMIN grants ADMIN, grants to colluding account) | 2 | 3 | High | No self-grant, SUPER_ADMIN-only admin grants, step-up | Partial | Role grants require four-eyes for ADMIN/SUPER_ADMIN (second approver) in addition to step-up; alert on every grant to channel outside the app; invariant job: >= 2 SUPER_ADMIN, list of staff reviewed monthly | M2 / M6 |
| P-4 | T/R | Malicious/coerced moderator removes competitors' reviews or approves paid reviews | 3 | 2 | High | COI guard, audit log, 100% post-review of AI-clean items | Partial | Anomaly detection over staff actions (per-seller removal concentration, bulk decisions, decision vs. AI disagreement rate), weekly senior review; bulk limits (exist); random second-review sample of human decisions; appeals decided by different person (exists) | M6 / M8 |
| P-5 | I | Insider browses PII / proofs / user data beyond need | 2 | 3 | High | Redacted copy default; break-glass original with reason | Partial | `user.manage` views and proof views logged; **per-staff rate cap on `proof.view_original`** and daily digest to SUPER_ADMIN; moderators never see email/IP (ipHash only); staff access from managed devices/VPN (ops) | M4 / M6 / M8 |
| P-6 | T | Audit log tampering or deletion by admin or SQL access | 1 | 3 | Medium | `AuditLog` | **Gap** | DB role separation (app role INSERT-only on `AuditLog`); hash-chain (`prevHash`) or periodic export to write-once (R2 object lock) storage; admin cannot read/modify `role.*` audit (exists) | M6 / M8 |
| P-7 | E | Moderation config (thresholds) changed to auto-approve everything / disable checks | 2 | 3 | High | `config.manage` ADMIN step-up, audited, validation | Partial | Four-eyes on config activation; **hard floors** in code (zero-tolerance categories and force-unsure rules cannot be disabled via config); alert on any config change; diff shown in audit | M6 |
| P-8 | E | Staff console XSS/CSRF leading to privileged action by a victim moderator | 2 | 3 | High | Strict CSP, Origin checks | Partial | User content rendered as escaped text only (no raw HTML/markdown with HTML); staff console on separate subdomain if feasible; step-up on high-risk actions (exists) | M6 |
| P-9 | E | Automated actors (AI/RULE) exceeding narrow permission set; job runs with ambient authority | 2 | 3 | High | System principal with fixed permissions | Covered | Typed principal in worker; test that AI principal cannot create SUSPENSION/BAN; jobs that act "on behalf of user" load actor and call `assertAuthorized` | M6 |
| P-10 | E | Race/TOCTOU: role or enforcement change not visible due to cache | 1 | 2 | Low | No cross-request caching of `ActorContext`; optional <= 30 s Redis session cache | Partial | If Redis cache is used, revocation must delete the key synchronously; test | M2 |

### 3.3 Seller ownership proof (data-model §6.3)

| ID | STRIDE | Threat | L | I | Risk | Existing design | Status | Mitigation / required control | Milestone |
|---|---|---|---|---|---|---|---|---|---|
| O-1 | S | Fraudulent claim of a competitor's/brand's seller profile to reply in their name or hurt them | 3 | 3 | **Crit** | DNS/meta/email-domain/doc/marketplace methods, ADMIN spot-check | Partial | Doc-based and marketplace claims always human-reviewed with a **second-reviewer for brands with existing claim or high review volume**; contested claim flow (existing verified owner is notified, claim goes to ADMIN case); reject claims for domains matching an already verified seller; challenge value random >= 128 bit, bound to claimant and seller, expires | M3 |
| O-2 | S | `BUSINESS_EMAIL_DOMAIN`: attacker gets mailbox on a shared/subdomain host (e.g. `*.github.io`, `shopify`, `wixsite`) or a role address (`info@`) is publicly readable | 2 | 3 | High | Free-mail domains rejected | Partial | Public-suffix-list check (private suffixes treated as shared); deny-list of hosting/site-builder domains; verification link bound to session user | M3 |
| O-3 | S | DNS/meta check passes for a domain the attacker controls but which belongs to another brand (name squatting, lookalike) | 2 | 2 | Medium | Challenge only proves control of a domain | Partial | Display verified domain publicly on seller page ("Verified: example.com"); link-text/IDN homograph normalisation (punycode display); ADMIN spot-check sampling of automatic approvals; trademark takedown via L-12 | M3 |
| O-4 | E/S | Domain takeover later (expired domain re-registered) keeps old verification | 2 | 2 | Medium | `verifiedUntil` 12 months | Partial | Periodic automatic re-check of DNS/meta (monthly); on failure, grace period then downgrade | M3 / M8 |
| O-5 | I/T | **SSRF** in website-meta fetcher and DNS checks (internal metadata IP, redirects, DNS rebinding) | 3 | 3 | **Crit** | "SSRF-safe fetcher" named only | Partial | Spec the fetcher: resolve then connect to the resolved IP; block private/loopback/link-local/cloud-metadata ranges (v4+v6), re-validate on every redirect (max 3), only http(s) ports 80/443, 5 s timeout, 1 MB cap, no cookies, own egress proxy/network policy with no access to internal network; run in a sandboxed worker without secrets in env | M3 |
| O-6 | T | Ownership **transfer** or OWNER invitation abused to take over a seller (compromised OWNER; invite to attacker) | 2 | 3 | High | Step-up, >= 1 OWNER, 2FA for OWNER/MANAGER | Partial | Invitations bound to verified email, expire 7 d, single-use; ownership transfer requires 2FA of both parties + 72 h delay with notification to all OWNERs and cancel link; audit | M3 |
| O-7 | T | Seller impersonation of verified status by name/logo similarity | 2 | 2 | Medium | Verified badge only when `VERIFIED` | Partial | Verified badge rendering from server state only; Seller name uniqueness/similarity check at creation (flag for review) | M3 |
| O-8 | I | Ownership evidence documents (business PII) leaked or retained | 2 | 2 | Medium | Private bucket, CHECK on private purpose | Covered | Same pipeline controls as purchase proof (§3.4); purge after decision + window | M3 / M5 |

### 3.4 Purchase (order) proof: PII handling and deletion (data-model §6.2)

| ID | STRIDE | Threat | L | I | Risk | Existing design | Status | Mitigation / required control | Milestone |
|---|---|---|---|---|---|---|---|---|---|
| R-1 | I | Leak of originals from private bucket (over-broad credential, misconfig, presigned URL leakage, backup) | 2 | 3 | High | Private bucket, least-privilege tokens, short presign | Partial | Web app has **no GET on ingest**; presigned GET <= 60 s, single-purpose, never logged; bucket public-access-block assertion in CI/infra test; originals deleted as soon as redacted copy + decision exist rather than only after appeal window where legal allows (decide with L-5 / minimise); bucket server-side encryption; backups exclude/expire proof objects <= retention | M4 / M5 / M8 |
| R-2 | I | Redaction failure: OCR/PII detector misses a field, moderator or AI provider sees PII | 3 | 2 | High | Redacted copy shown to moderators | Partial | Treat redaction as best-effort: fail-closed (if OCR confidence low -> **mask whole image except merchant/date/total region** or require user-side redaction); redacted copy visible only to `proof.review`; moderator UI shows watermark with moderator id; accepted residual risk documented | M4 / M5 |
| R-3 | I | PII sent to AI/OCR provider (processor, cross-border) | 2 | 3 | High | "no model training", DPA assumed (L-6) | Partial | Send **redacted** image/text only, never original; provider under DPA with zero-retention flag; EU region for EU users; opt-out switch to human-only review; **OPEN(LEGAL) L-6** | M4 / M6 |
| R-4 | I | PII in logs, error trackers, OCR text stored in DB, outbox payloads, job payloads (Redis) | 3 | 2 | High | "aiAssessment (no raw PII)" | Partial | Log scrubber and schema allow-list for `aiAssessment`/`OutboxEvent`/BullMQ payloads (ids only, no OCR text); Redis not persisted with payloads beyond TTL; Sentry `beforeSend` scrubbing; CI test seeding a canary PII string and asserting it appears in no log/DB column | M4 / M5 / M8 |
| R-5 | T | Forged / fabricated proofs (edited receipts, AI-generated, recycled across accounts) | 3 | 2 | High | fileFingerprint, pHash, `orderReferenceHash` duplicate checks, AI extraction | Partial | EXIF/PDF producer anomaly signals, error-level analysis as signal only, merchant+date+product consistency; `orderReferenceHash` unique per (merchant, order) across accounts -> `TrustSignal`; the verified label is a **trust signal, not a guarantee** (copy reviewed with L-2); `VERIFIED_LABEL_REVOKED` path exists | M4 / M7 |
| R-6 | I | HMAC key for `orderReferenceHash` guessable-input dictionary attack after leak (order numbers are low-entropy) | 1 | 2 | Low | Keyed HMAC | Partial | Key in secrets manager, separate from DB; include merchant id in HMAC input; rotation plan | M4 |
| R-7 | R/T | **User deletion not honoured**: copies remain (redacted copy, thumbnails, CDN, derived pHash, backups, queue payloads) | 2 | 2 | Medium | Delete within 24 h by job; tombstone row | Partial | Deletion job inventories every derived object via `derivedFromId`; verification step (HEAD returns 404) and `filesPurgedAt` only set after verification; failed purge alerts; backup retention <= proof retention or documented restore-then-redelete procedure; `legalHold` can't be set by users | M5 / M8 |
| R-8 | I | Retained attestation (`merchantName`, `purchaseDate`, fingerprint, `orderReferenceHash`) is personal data after erasure | 1 | 2 | Low | Anonymisation on account deletion | Partial | On account erasure null `reviewerId` linkage / unlink to user; `OPEN(LEGAL)` L-4, L-7 | M8 |
| R-9 | E | Break-glass `proof.view_original` abuse | 2 | 3 | High | SENIOR_MOD, step-up, typed reason, audit | Partial | See P-5 caps and daily digest; original served via short-lived URL with `Content-Disposition: inline`, `Cache-Control: no-store`; second approver for batch/repeated views of the same user | M6 |
| R-10 | D/T | Proof upload spam to exhaust moderator/OCR capacity or run up AI costs | 3 | 2 | High | Per-user upload limits, 5 per parent | Partial | Proof submissions: 1 pending per review, 5/day/user; budget cap per day on AI/OCR calls with fail-to-human-queue (not auto-approve) | M4 / M6 |

### 3.5 Malicious uploads (media-pipeline.md, ADR-0006)

| ID | STRIDE | Threat | L | I | Risk | Existing design | Status | Mitigation / required control | Milestone |
|---|---|---|---|---|---|---|---|---|---|
| U-1 | T/E | Parser exploits (libvips/ffmpeg/HEIF/PDF) via crafted files -> RCE in worker | 2 | 3 | High | Worker-only processing, virus scan, resource limits, no network | Partial | Sandbox concretely: separate container, non-root, read-only FS, seccomp/no network namespace, memory/CPU/time limits, no secrets in env (storage creds via short-lived scoped token per job or pre-fetched input); ffmpeg `-protocol_whitelist file`, disable HLS/concat demuxers, input allow-list by probed format; keep libs patched (dependency audit in CI) | M5 |
| U-2 | D | Decompression bombs, pixel floods, giant PDFs, zip-in-PDF, long videos | 3 | 2 | High | 50 MP cap, duration cap, byte cap, transcode timeout | Covered | Test with bomb corpus; per-job memory limit kills job without affecting queue; PDF pages <= 20 | M5 |
| U-3 | T | Content-type confusion / polyglot (image that is also HTML/JS/PDF) | 2 | 2 | Medium | Magic bytes, transcoded outputs, nosniff, cookieless host | Covered | **Always re-encode** (never serve the original bytes) for public media; served `Content-Type` set from our table; `Content-Disposition` and `X-Content-Type-Options: nosniff`; `Content-Security-Policy: sandbox` on media host | M5 |
| U-4 | E | Storage key / path manipulation, overwrite of another user's object via presigned URL | 2 | 3 | High | Server-generated key | Covered | Presign bound to exact key, content-length-range, content-type, checksum; **confirm step re-verifies by HEAD + size and that the key belongs to the caller's pending slot**; one-time slot | M5 |
| U-5 | T | Upload-confirm race / swapping object after scan (TOCTOU between scan and promote) | 2 | 3 | High | Ingest vs. public buckets, worker promote | Partial | Ingest bucket write-once after confirm (reject overwrite via conditional PUT / disallow after confirm; process by `sha256` computed once and verify at promote); promote copies the **processed derivative**, never the ingest object | M5 |
| U-6 | I | EXIF/GPS and device metadata leak (home address) | 3 | 2 | High | Metadata stripped for all variants | Covered | Test: GPS sample fixture produces no EXIF in any public variant (incl. videos: strip container metadata, `-map_metadata -1`) | M5 |
| U-7 | I/S | XSS or script via filenames, SVG, `Content-Type` on served objects, or via image served from app origin | 1 | 3 | Medium | No SVG, no user filenames, separate host | Covered | CSP `img-src`/`media-src` allow-list the media host only; no user-controlled `Content-Disposition` | M5 |
| U-8 | T | Illegal content (CSAM, terrorist, NCII) uploaded and published | 2 | 3 | High | Quarantine until moderation; banned-hash list; zero-tolerance escalation | Partial | Hash-matching service integration before launch (**OPEN(LEGAL) L-17**); never publish before scan + moderation pass; evidence preservation + reporting runbook; moderator wellness/blur-by-default in queue | M5 / M6 / M8 |
| U-9 | D | Storage/egress cost abuse (upload then abandon; mass slots) | 3 | 1 | Medium | Slot limits 60/h 300/d, halved for NEW | Covered | Lifecycle rule to delete `UPLOADING` objects after 24 h; ingest bucket total-bytes alert | M5 / M8 |
| U-10 | S | Malicious media URL / remote fetch (SSRF via "import from URL") | 1 | 3 | Medium | Not offered | Covered | Keep a **policy: no server-side fetch of user-supplied URLs** other than the ownership fetcher (see O-5) | M5 |
| U-11 | I | Presigned GET/PUT URL leakage (Referer, logs, shared) | 2 | 2 | Medium | 10 min PUT | Partial | `Referrer-Policy: no-referrer` on pages showing private media; PUT URLs not logged; GET URLs for private media <= 60 s | M5 |
| U-12 | T | CDN cache poisoning / stale public copy after demotion | 1 | 2 | Low | Purge on demote | Partial | Purge failure alert; short TTL on newly published media; unguessable keys do not replace authz | M5 |

### 3.6 Fake reviews and vote manipulation

| ID | STRIDE | Threat | L | I | Risk | Existing design | Status | Mitigation / required control | Milestone |
|---|---|---|---|---|---|---|---|---|---|
| F-1 | S/T | Sock-puppet farms posting fake positive/negative reviews, review bombing a competitor | 3 | 3 | **Crit** | Email verification, trust bands, AI + human moderation, hold timers | Partial | Signals into `TrustSignal`: account age, device/ipHash cluster, burst velocity per product, text similarity (MinHash) across accounts, reviewer-seller graph overlap; auto-route bursts on a product to HUMAN lane and hold ratings out of the aggregate until reviewed; new-account (`NEW` band) reviews weighted low in aggregates; per-user review limit/day | M4 / M6 / M7 |
| F-2 | T | Vote rings (helpful votes), self-boosting via alt accounts, brigading a review | 3 | 2 | High | One vote per user per review, no own-review, trust-weighted at aggregation, voting restriction | Partial | Votes from `NEW` band count 0 until account maturity (e.g. 7 d + verified email + N actions); ipHash/device clustering reduces weight; velocity anomaly detection (daily aggregate, §6.5) with votes frozen on flagged reviews; vote rate limit per user (e.g. 60/h); unique `(userId, reviewId)` DB constraint (exists) plus idempotent API; **votes cannot be changed more than N times** | M4 / M7 |
| F-3 | T | Seller self-reviewing / employees/relatives; sellers paying for reviews | 3 | 3 | **Crit** | COI block on seller members; incentive disclosure field | Partial | Block by verified seller-email domain match at review time; reciprocity ("review swap") graph detection; seller incentive disclosure required; rating-aggregate uses verified buyers separately; takedown process for detected paid-review networks (`BAN` + `VERIFIED_LABEL_REVOKED`) | M4 / M6 / M7 |
| F-4 | T | Forged verified-buyer label through fake proofs | 3 | 2 | High | See R-5 | Partial | See R-5; verified label can be **revoked retroactively** and aggregate recomputed | M4 / M7 |
| F-5 | T | Seller reply abuse: replies contain phishing/off-platform bait, harassment; competitor replies in another seller's name | 2 | 2 | Medium | Moderated, `VERIFIED` only, 2FA | Covered | Link policy (no external URLs, or via interstitial/nofollow), moderate replies | M3 / M6 |
| F-6 | T | Review edit-after-approval ("bait and switch") | 3 | 2 | High | Edits create `ReviewRevision` moderated, live content stays old until approved | Covered | Test T14 and rate limit; verify rating change is re-moderated | M6 |
| F-7 | T | AI moderation evasion (prompt injection in review text, adversarial text, language unsupported), including attempts to instruct the moderation model | 3 | 2 | High | AI failure -> UNSURE; force-unsure rules; unsupported language -> human; 100% human post-review | Partial | Treat review text as data: structured output schema, delimiters, no tool use in the classifier; model output cannot widen auto-approve beyond config thresholds; **no free-text from the model is rendered unsanitised in the staff console**; injection canary test set | M6 |
| F-8 | T | Trust-score gaming (earn score cheaply, then abuse) | 2 | 2 | Medium | Internal scores; explainable inputs | Partial | Cap per-signal contributions; decay; scores never public for users; sudden behaviour change lowers band | M7 |
| F-9 | D | Report-flooding (mass false reports to take down a competitor's review or seller) | 3 | 2 | High | `report.create` rate-limited, case-based | Partial | Reports never auto-hide on count alone from `NEW` accounts; reporter reputation weighting; per-reporter/target caps; duplicates collapse into one case | M6 / M7 |
| F-10 | T | Comment/post spam, link spam, scraping reviews | 3 | 1 | Medium | Rate limits, moderation | Partial | Same limiter layer; honeypot + CAPTCHA escalation; robots/WAF rules; public pagination caps | M7 / M8 |

### 3.7 Rate limiting and denial of service

| ID | STRIDE | Threat | L | I | Risk | Existing design | Status | Mitigation / required control | Milestone |
|---|---|---|---|---|---|---|---|---|---|
| D-1 | D | Rate limiting defined only for auth endpoints; write/vote/report/upload/search have only mentions | 3 | 2 | High | Auth limits; upload slots; edit limit; report "rate-limited" | **Gap** | **Central limiter registry** (below, §5) used by the action wrapper (P-1); default-deny limit for any new mutating action | M2 (infra), M4-M7 (per feature) |
| D-2 | D | IP-based limits bypassed via proxies / blocked via shared NAT; `X-Forwarded-For` spoofing | 3 | 2 | High | Per IP and per account | Partial | Trust XFF only from the CDN/proxy hop (configured trusted-proxy count); limits keyed by user id **and** IP; failure of Redis -> **fail closed for auth endpoints, fail open (with local in-memory fallback) for read paths** | M2 |
| D-3 | D | Queue flooding (moderation, media) starving legitimate work; poison messages | 2 | 2 | Medium | Separate queues, concurrency limits, `media-video` separate | Partial | Per-user enqueue caps; dead-letter queue with alert; job payload size caps; priority lanes for staff-created work | M5 / M6 |
| D-4 | D | Expensive queries (search, comparison, deep pagination, aggregate recompute) | 2 | 2 | Medium | Index plan | Partial | Max page size/depth; query timeouts; comparison items cap (e.g. 4); cache of public pages | M7 |
| D-5 | D | AI provider outage/cost exhaustion | 2 | 2 | Medium | AI failure -> UNSURE | Covered | Daily spend cap, backlog alert (staff backlog row); never auto-approve on failure | M6 |
| D-6 | D | Account lockout abuse | 1 | 2 | Low | No hard lockout | Covered | Keep as is | M2 |

### 3.8 Other cross-cutting threats

| ID | STRIDE | Threat | L | I | Risk | Status | Mitigation / required control | Milestone |
|---|---|---|---|---|---|---|---|---|
| X-1 | T | Stored XSS in reviews/posts/comments/seller replies/product data/seller names | 3 | 3 | **Crit** | Partial | React escaping only; no `dangerouslySetInnerHTML`, no raw markdown HTML; CSP nonce; sanitise rich text with allow-list lib if introduced; output-encoding test suite with payload corpus | M2 (CSP) / every UI milestone |
| X-2 | T | SQL injection / Prisma raw queries | 1 | 3 | Medium | Covered | Ban `$queryRawUnsafe`; parameterised raw only; SAST rule in CI | M2 |
| X-3 | I | Secrets leak (repo, logs, CI) | 2 | 3 | High | Partial | Secret scanning in CI + pre-commit; secrets manager only; separate keys per env; rotation runbook | M2 / M8 |
| X-4 | T | Dependency / supply chain compromise (npm, native bindings) | 2 | 3 | High | Gap | Lockfile + `npm audit`/OSV in CI, Dependabot/Renovate, pinned versions of Argon2/ffmpeg/libvips, provenance for container images | M2 / M8 |
| X-5 | I | Over-broad API/Server Action responses (returning email, ipHash, status, trust score) | 3 | 2 | High | Partial | DTO mappers per audience (public/self/staff); never return Prisma models directly; test that public DTOs have no private fields | M3-M7 |
| X-6 | T | Outbox/worker event forgery or replay (duplicate side effects) | 1 | 2 | Low | Partial | Idempotency keys on jobs; events written only in DB transaction | M6 |
| X-7 | S | Email spoofing/phishing from our domain | 2 | 2 | Medium | Gap | SPF/DKIM/DMARC; transactional email templates without user-supplied links | M2 / M8 |
| X-8 | I | Clickjacking, mixed content, missing headers | 1 | 2 | Low | Covered | CSP `frame-ancestors 'none'`, HSTS; header test | M2 |
| X-9 | I | Public profile/user data scraping, user tracking via ipHash | 2 | 2 | Medium | Partial | ipHash keyed HMAC with rotation; 90-day retention (L-11) | M8 |

## 4. Design gaps requiring changes to M1 documents (action list)

These are **findings** against the M1 designs. The security engineer did not modify those docs; each item should be accepted into the owning ADR/doc by the Software Architect (or an ADR amendment) before the named milestone starts.

| # | Gap | Owner doc | Needed by |
|---|---|---|---|
| G-1 | Per-session and per-account attempt cap on the pending-2FA and recovery-code step; recovery codes hashed with HMAC/Argon2id (A-1, A-7) | ADR-0002 §3, §5 | M2 |
| G-2 | `defineAction()` wrapper + CI rules making authz and rate-limit registration mandatory (P-1, D-1) | ADR-0003 §4 | M2 |
| G-3 | Central rate-limit registry with fail-open/closed policy and trusted-proxy handling (D-1, D-2) | ADR-0002 §5 / new ADR | M2 |
| G-4 | SSRF-safe fetcher specification (O-5) | data-model §6.3 / new doc | M3 |
| G-5 | Four-eyes for ADMIN/SUPER_ADMIN grants and `config.manage` activation; hard floors for zero-tolerance rules (P-3, P-7) | ADR-0003, moderation-pipeline §5 | M6 |
| G-6 | Append-only audit log with DB role separation and hash-chain or external WORM export (P-6) | ADR-0004 | M2 (DB roles), M8 |
| G-7 | Worker sandbox profile (U-1), ingest write-once semantic and confirm-ownership check (U-4, U-5) | media-pipeline §4, §9 | M5 |
| G-8 | Allow-list schema and CI canary test to keep PII out of logs, outbox, queue payloads and `aiAssessment` (R-4) | data-model §6.2 | M4 |
| G-9 | Seller-claim contest flow, PSL/shared-host domain rules, delayed ownership transfer (O-1, O-2, O-6) | data-model §6.3 | M3 |
| G-10 | Minimisation: delete proof **originals** once redacted copy + decision exist, instead of waiting for appeal window, unless Legal requires otherwise (R-1) | data-model §6.2 / L-5 | M4 |
| G-11 | Vote maturity gating and velocity freezes (F-2) | moderation / trust design | M7 |
| G-12 | Open redirect allow-list (A-13), non-enumerating signup (A-9) | ADR-0002 | M2 |

## 5. Rate-limit baseline (proposal)

Single registry in `packages/core/ratelimit`: `{ key, subject(user|ip|both), window, max, onExceed }`. Starting values (tune from data):

| Action | Subject | Limit | On exceed |
|---|---|---|---|
| Login | IP + identifier | 10/15 min/IP; 5/15 min/identifier; CAPTCHA after 3 | delay, CAPTCHA |
| 2FA verify / recovery code | session + user | 5 per pending session; 10/15 min/user | kill pending session |
| Signup / resend verification | IP, email | 5/h/IP; 3/h/email | 429 |
| Password reset | IP, email | 5/h/IP; 3/h/email (same response always) | silent drop |
| Review create | user | 5/day (NEW: 2/day); 1 per product | 429 |
| Edit of live content | user | 5/day (exists) | 429 |
| Vote | user | 60/h; NEW band 20/h | 429, flag |
| Report | user | 20/day; max 1 per target | 429 |
| Comment/post | user | 30/h (NEW 10/h) | 429 |
| Upload slot | user | 60/h, 300/day (halved NEW) (exists) | 429 |
| Proof submit | user | 5/day | 429 |
| Seller claim submit | user, seller | 3/day/user; 5 per seller/30 d | 429 + admin alert |
| Staff `proof.view_original` | staff | 20/day, alert at 10 | deny + alert |
| Search / public reads | IP | 120/min (WAF + app) | 429 |

## 6. Mitigation roll-up by milestone

| Milestone | Security deliverables (blocking unless marked) |
|---|---|
| **M2 Identity & auth** | A-1..A-14 controls; `authorize()` + `defineAction()` + CI lint (P-1); rate-limit registry (D-1/D-2); CSP/HSTS/headers (X-1, X-8); CSRF origin check (A-10); DB roles with INSERT-only `AuditLog` (P-6, A-12); secret scanning, dependency audit, SAST in CI (X-2..X-4); authz matrix test generator (ADR-0003 §5); email SPF/DKIM/DMARC (X-7) |
| **M3 Catalog & sellers** | SSRF-safe fetcher (O-5); claim contest, PSL/shared-host rules, delayed ownership transfer (O-1, O-2, O-6); periodic re-verify (O-4); cross-seller tests (P-2); DTO mappers (X-5); reply link policy (F-5) |
| **M4 Reviews, votes & proof** | Proof PII controls: redaction fail-closed, processors only see redacted data, log/outbox scrub + canary test (R-2..R-4); proof submit limits (R-10); duplicate/forgery signals (R-5); vote constraints and limits (F-2); review rate limits and burst detection hooks (F-1); minimisation of originals (G-10) |
| **M5 Media** | Worker sandbox, ffmpeg/libvips hardening, bomb corpus tests (U-1, U-2); presign binding + confirm ownership check, write-once ingest (U-4, U-5); re-encode all public media, media-host headers (U-3, U-7); EXIF tests (U-6); hash-matching hook (U-8); lifecycle rules (U-9); deletion verification (R-7) |
| **M6 Moderation & staff** | Anomaly detection on staff actions (P-4); four-eyes config/role grants, hard floors (P-3, P-7); break-glass caps + digest (P-5, R-9); staff console XSS hardening (P-8); AI prompt-injection tests, structured outputs (F-7); AI spend caps/backlog (D-5); report-flood controls (F-9); audit hash-chain/WORM export (P-6); queue DLQ (D-3) |
| **M7 Trust, social, comparison** | Fake-review graph/similarity signals, aggregate hold (F-1, F-3); vote maturity gating + velocity freezes (F-2); trust-score caps/decay (F-8); query cost limits (D-4); anti-scrape (F-10) |
| **M8 Hardening & launch** | External pen-test and the pre-launch security review ADR-0002 requires; chaos/backup-restore test for proof deletion (R-7); key rotation drills (A-14, R-6); log-scrub verification in production config; legal-dependent items closed (L-4..L-7, L-17); incident-response and staff-2FA-reset runbooks; DDoS/WAF tuning (D-2) |

## 7. Residual risks accepted for Phase 1

- Fake receipts that pass automated + human review (verified label is a signal, not proof; revocable).
- Redaction (OCR) cannot be perfect; PII exposure to moderators is limited by fail-closed masking and audit, not eliminated.
- Video audio is not moderated (moderation-pipeline M-4).
- Insider collusion between two privileged staff cannot be fully prevented; detection (P-4, P-6) is the control.
- Legal-dependent controls (CSAM hash-matching, retention periods, erasure semantics) are unresolved until Legal answers L-1..L-17.

## 8. Verification plan

Each Critical/High threat above gets at least one automated test or CI check named in the owning milestone task. Suggested harness:
authz matrix (ADR-0003 §5), route-registry coverage test, rate-limit registry coverage test, malicious-file corpus (bombs, polyglots, EXIF/GPS, malformed HEIC/MP4), SSRF corpus (private IPs, DNS rebinding, redirects), PII canary test, XSS payload corpus across all rendered user fields, injection canary set for the moderation classifier.

---

## 9. Addendum (task #26, M1-T3): appeals, moderation tooling, secrets and credentials

This addendum closes gaps left in the first draft. It adds the threats raised by the approved lifecycle design
([moderation-lifecycle.md](../architecture/moderation-lifecycle.md), ADR-0011, ADR-0013, [job-catalogue.md](../architecture/job-catalogue.md)),
and gives secrets and least-privilege guidance. Risk scale and milestone mapping are as in §0 and §2.
Same caveat as before: design-level review, nothing tested against a running system.

### 9.1 Appeals and enforcement (moderation-lifecycle §5)

| ID | STRIDE | Threat | L | I | Risk | Design status | Mitigation / required control | Milestone |
|---|---|---|---|---|---|---|---|---|
| AP-1 | E | Appeal reviewer decides their own case or a colluding party's (reviewer = original decider, appellant, or COI seller) | 2 | 3 | High | Covered (A2 guard) | Enforce guard in `transition()` not UI; test reviewer ∈ deciders, reviewer = appellant, seller-member COI. Overturn of a `BAN`/`SELLER_SUSPENSION` appeal needs a second reviewer (four-eyes) | M6 |
| AP-2 | T | Appeal used to relaunder content: overturn (T12/R8) re-publishes content with a *different* body than the one rejected (TOCTOU on `contentVersion`) | 2 | 3 | High | Partial | A1 binds appeal to `contentVersion`; A4 must re-check the version equals the deciding case's version inside the same transaction, else fail. Test edit-during-appeal | M6 |
| AP-3 | D | Appeal flooding (many appeals or repeated appeals to exhaust reviewers, delay strikes) | 3 | 2 | High | Partial (unique per case) | Limiter entry `appeal.create` (3/day/user); one open appeal per case; reporter appeals (T18) restricted to non-`NEW` accounts; SLA breach is a metric, never an auto-outcome (A7, already in design) | M6 |
| AP-4 | I | Appeal text or evidence leaks personal data of other users (reporter identity, moderator identity, other reviewer notes) | 2 | 2 | Medium | Partial | Appeal DTOs per audience: appellant sees `publicReason` only, never reporter id, staff ids, AI scores or internal notes. Statement-of-reasons export built from an allow-list | M6 |
| AP-5 | T/R | Reviewer lease abuse: claim and sit on cases to starve queues, or steal a lease mid-decision to alter an outcome | 2 | 2 | Medium | Covered (15 min lease) | Decision requires lease held at commit time (`leaseHeld` in audit). Alert on claim-without-decision rate per reviewer | M6 |
| AP-6 | R | Appeal outcomes not attributable (decision note editable, audit absent) | 1 | 2 | Low | Covered (one `AuditLog` row per transition, same tx) | `decisionNote` immutable after commit; audit action `appeal.*` exists for every A-row; test no-op writes no row | M6 |
| AP-7 | S | Account owner appeals on behalf of someone else (IDOR on `appealId`/`caseId`) | 2 | 3 | High | Partial | Appellant derived from session only. Authorisation test: user B cannot read, file or withdraw user A's appeal. Applies equally to seller-scoped appeals (resource-derived scope, P-2) | M6 |

### 9.2 Moderation tooling and worker pipeline

| ID | STRIDE | Threat | L | I | Risk | Design status | Mitigation / required control | Milestone |
|---|---|---|---|---|---|---|---|---|
| MT-1 | T | Forged or replayed outbox event / job triggers a state transition (e.g. `moderation.hold-expire` run early) | 1 | 3 | Medium | Covered (ADR-0007/0013: only the outbox enqueues, id-only payloads, job re-reads DB, no-op if deadline changed) | Redis is **not** trusted. Treat any job as a hint: handler must re-validate state and deadline from MySQL. Redis requires auth + TLS, network-isolated, not reachable from the browser tier except via the web app | M2 (infra) / M6 |
| MT-2 | E | Worker holds credentials broader than needed (DB write on all tables, both buckets, AI key) so one RCE (U-1) owns everything | 2 | 3 | High | Partial | Split worker deployment groups (`core`, `media`, `media-video`) each with its own DB user and bucket token. The `media` group must have **no** AI key and no network egress except storage (U-1) | M5 |
| MT-3 | T | Bulk moderation action used for mass takedown or mass approval | 2 | 3 | High | Partial | Cap bulk size; second approval above a threshold; per-staff anomaly alert (P-4); `moderation.bulk` audit row (already specified) | M6 |
| MT-4 | I | Staff queue views expose more than needed (email, ipHash, trust score, proof originals) | 2 | 2 | Medium | Partial | DB views for queues return a column allow-list; staff DTO mapper; originals only via break-glass (R-9) | M6 |
| MT-5 | T | Moderation config activation races with in-flight cases (versioned config replaced mid-decision) | 1 | 2 | Low | Covered (versioned config, `configVersion` in audit) | Test: decision records the config version it used | M6 |
| MT-6 | D | Sweepers or poison jobs retried forever, exhausting DB/AI budget | 2 | 2 | Medium | Covered (bounded attempts, DLQ) | DLQ alert, per-queue concurrency, AI spend cap (D-5) | M6 |

### 9.3 Secrets handling

**Principles.** No secret is ever committed, printed, logged, put in a job payload or sent to the browser. Each environment (dev, staging, prod) has its **own** value of every secret. Secrets live in a managed secret store (or the host's secret facility), injected as environment variables at runtime. `.env` stays git-ignored and `.env.example` holds placeholders only (verified: `.gitignore` ignores `.env` and `.env.*` except `.env.example`).

| Secret | Used by | Rules |
|---|---|---|
| `DATABASE_URL` (web, worker-core, worker-media: separate users) | web, workers | Distinct DB users per component. Web: no DDL. Migrations run by a separate migrator user used only in the deploy step. `AuditLog`: INSERT/SELECT only (P-6) |
| Session/CSRF signing, ipHash HMAC key | web | Random 256-bit; rotation plan keeps the previous key valid for verification only |
| TOTP encryption key (AES-256-GCM, `keyId`) | web | Stored **apart from DB backups** (A-14); rotation job; key-loss runbook |
| `orderReferenceHash` HMAC key | web/worker-core | Separate key from the others (R-6); never reused |
| R2 / S3 credentials | web, workers | See §9.5. One token per component and per bucket |
| AI provider key | worker-core only | Not available to the web app or `media` group; spend cap; zero-retention flag (R-3) |
| SMTP / email API key | web or worker-core | Send-only scope; separate per environment |
| Google OAuth client secret | web | Exact-match redirect URIs (A-13) |
| CI/CD and GitHub tokens | pipelines | See §9.4 |

Controls (all mapped to M2 unless noted):

1. **Secret scanning** in CI (gitleaks or equivalent over the full diff and history on PRs) plus GitHub push protection; pre-commit hook recommended. A finding means **rotate first, then clean history**.
2. **Config validation at boot**: a zod env schema fails the process on missing or placeholder secrets. Secrets are never echoed in the error. `NEXT_PUBLIC_*` variables must never carry secrets (CI grep rule on `NEXT_PUBLIC_` names containing `KEY|SECRET|TOKEN|PASSWORD`).
3. **Log scrubber** redacts `authorization`, `cookie`, `set-cookie`, `*_KEY`, `*_SECRET`, `*_TOKEN`, presigned-URL query strings (`X-Amz-Signature`). Covered by the canary test from G-8.
4. **Rotation runbook** (M8 deliverable, skeleton in M2): owner, interval (90 days for service tokens, at once on suspected leak or staff departure), and how to roll without downtime (dual-key window).
5. **No secrets in CI for PR builds**: the current `ci.yml` uses throwaway values only, with `permissions: contents: read`. Keep it so: never use `pull_request_target` with a checkout of PR code; do not expose deploy secrets to forks.
6. **Docker/compose**: `docker-compose.yml` is for local dev with throwaway credentials; production images are built without `.env` (`.dockerignore` must list `.env*`; check at scaffold).
7. **Developer access**: no shared prod credentials; prod DB access via audited break-glass, not stored in laptops.
8. **AI agents and automation** (the platform runs autonomous workers on this repo): agent runs must not receive prod secrets; they work on branches and cannot push to `main`.

### 9.4 GitHub tokens: least privilege

| Use | Recommended credential | Permissions | Notes |
|---|---|---|---|
| CI jobs (build, lint, test) | Built-in `GITHUB_TOKEN` | Workflow-level `permissions: contents: read` (already set); grant extra scopes per job only | Default token permissions in repo settings set to **read-only** |
| Dependency updates (Dependabot/Renovate) | Dependabot native, or a GitHub App | PRs and contents on this repo only | Not a personal token |
| Automation that opens PRs/merges (platform worker) | **GitHub App** installation token or a **fine-grained PAT** limited to **this one repository** | `contents: write` and `pull_requests: write` on feature branches. **No** `administration`, `workflows`, `secrets`, `actions`, org scopes | Expiry <= 90 days; owned by a bot account, not a person; 2FA on the bot owner |
| Deploy | OIDC federation from Actions to the cloud/hosting account (short-lived) | Deploy role scoped to one environment | No long-lived cloud keys in repo secrets. Production environment requires reviewer approval |
| Humans | SSO/2FA, no classic PATs | Review required | Classic PATs prohibited by policy |

Repository settings to enforce (M2, owner: repo admin): branch protection on `main` (PR required, CI green, at least one review, no force-push, no direct pushes by the automation identity; CEO approval gate stays as is); CODEOWNERS for `docs/security/`, `.github/`, `packages/core/auth`, migrations; pin third-party Actions by commit SHA (currently tag-pinned `@v4`, accepted risk, see §9.7 R-S3); secret scanning and push protection on; Dependabot alerts on; Actions allowed only from GitHub and an allow-list; "approve workflows from first-time contributors" on.

### 9.5 Object-storage credentials: least privilege (ADR-0006)

Three buckets per environment: `ingest` (private, raw), `private` (redacted proofs and evidence), `public` (served via CDN host). Never share credentials between environments or components.

| Component | `ingest` | `private` | `public` | Notes |
|---|---|---|---|---|
| Web app (presigner) | **Sign PUT only** (key-bound, size and content-type limited, <= 10 min); no GET, no LIST, no DELETE | Sign GET <= 60 s; no PUT | none | The web token cannot read raw uploads or write public media. Confirm step uses HEAD via a separate narrow capability, or a worker callback, not broad read |
| Worker `media` | GET, DELETE | PUT | PUT (promote), DELETE (demote), purge | No LIST on `private` beyond its prefix where the provider supports prefix scoping |
| Worker `core` | none | GET/DELETE on proofs for the deletion job | none | Deletion job only |
| CDN / public host | none | none | read-only, via CDN origin access, no write | Bucket not world-writable; listing disabled |
| Staff proof viewer | via web presign only | short-lived GET with `no-store` | none | Every issue is audited (R-9) |
| Backup/lifecycle admin | separate admin credential, not used by any running service | | | Kept offline; used for lifecycle and CORS setup |

Additional controls: scope R2 API tokens to **specific buckets** (object-level read/write as above), not "account-wide"; CORS on `ingest` allows only the app origin and `PUT`; lifecycle deletes `UPLOADING` objects after 24 h and ingest after the 2-day backstop; bucket-level object lock/versioning on any audit export (P-6); alerts on unusual egress and on credential use from unexpected IPs where supported; separate dev/staging/prod accounts or at least separate tokens and buckets; presigned URLs are never logged (U-11).

### 9.6 Updated roll-up: additions by milestone

| Milestone | Additional deliverables from this addendum |
|---|---|
| M2 | Secret scanning + push protection, env schema validation, log scrubber with canary test, branch protection + CODEOWNERS, read-only default workflow token, token inventory and rotation skeleton, Redis auth/TLS/network isolation (MT-1), component-specific DB users (MT-2 prep) |
| M5 | Per-component storage tokens as §9.5; `media` worker group without AI key or egress (MT-2) |
| M6 | AP-1..AP-7 controls and tests; MT-3..MT-6; appeal DTO allow-lists; four-eyes for ban/suspension overturn |
| M8 | Rotation drills for all §9.3 secrets, review of all tokens against §9.4/§9.5 tables, pin Actions by SHA |

### 9.7 Additional secrets/supply-chain risks

| ID | STRIDE | Threat | L | I | Risk | Mitigation | Milestone |
|---|---|---|---|---|---|---|---|
| R-S1 | I | Long-lived storage or GitHub token leaked (log, repo, laptop) and used for bulk read of proofs or repository takeover | 2 | 3 | High | §9.3-9.5: per-component scoped tokens, expiry, scanning, alerts, rotation runbook | M2 / M5 |
| R-S2 | E | Over-privileged automation token pushes to `main` or edits workflows to exfiltrate secrets | 2 | 3 | High | Fine-grained/App token without `workflows` scope; branch protection; CODEOWNERS on `.github/` | M2 |
| R-S3 | T | Compromised third-party GitHub Action (tag moved) runs in CI | 2 | 2 | Medium | CI has no real secrets and read-only token; pin by SHA by M8; Dependabot for Actions | M2 / M8 |
| R-S4 | I | Secrets baked into the Docker image or Next.js client bundle | 2 | 3 | High | `.dockerignore`, `NEXT_PUBLIC_` rule, build-time check, only runtime injection | M2 |

## 10. Security checklist for M2 (Auth and Accounts)

Use as the review gate for the M2 PR(s). Each item cites the threat. "Evidence" means a named automated test, CI check, or a config reference. Items marked **[B]** block enabling signup in any shared environment.

### 10.1 Sessions and cookies
- [ ] **[B]** `__Host-sid` cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`; token 256-bit random; only SHA-256 stored (A-3). Evidence: cookie attribute test.
- [ ] **[B]** Session rotation on login, 2FA completion, password change, privilege change (A-4). Revocation matrix of ADR-0002 §1 tested, including suspension/ban effective on next request.
- [ ] Idle/absolute timeouts differ for staff (2 h/12 h) and users (30 d/90 d); `lastActiveAt` refresh throttled to 5 min.
- [ ] If the Redis session cache is used, revocation deletes the key synchronously (P-10).
- [ ] Session tokens never appear in URLs, logs, error reports (scrubber test, A-3).

### 10.2 Credentials and recovery
- [ ] **[B]** Argon2id (m>=19 MiB, t>=2, p=1; ~250 ms), rate limit **before** hashing, concurrent hash cap (A-11); dummy verify for unknown emails to equalise timing (A-9).
- [ ] **[B]** Login, signup, reset and resend are non-enumerating in body and timing (A-9, G-12).
- [ ] Breached-password k-anonymity check; fail-open is logged; min length 10, no composition rules.
- [ ] Verification and reset tokens: random, hashed at rest, single-use, expiry 24 h / 30 min; reset revokes all sessions and **does not** disable or bypass 2FA (A-8).
- [ ] Email change: step-up, notice to old address with 24-48 h revert link (A-8).
- [ ] Unverified accounts cannot create content, vote, report or follow.

### 10.3 Google OIDC
- [ ] **[B]** PKCE, `state`, `nonce` validated; exact-match redirect URIs (A-13); only `provider+sub` stored, no provider tokens.
- [ ] **[B]** Link only if Google email verified **and** control of the existing account proven; pre-account-takeover test (A-2); if the local account was never email-verified, revoke its sessions and force reset.

### 10.4 Two-factor
- [ ] **[B]** Pending-2FA session: 10 min expiry, may call only the verify endpoint (default-deny middleware), per-session cap of 5 attempts that kills the session, 10/15 min/user across sessions (A-1, A-5, G-1). Evidence: test every route with a pending session.
- [ ] TOTP secret AES-256-GCM with `keyId`; enrolment confirmed by a valid code before `enabled`; secret shown once; `lastUsedStep` replay rejection (A-6, A-14).
- [ ] Recovery codes: >= 50 bits, stored as keyed HMAC or Argon2id (not bare SHA-256), share the TOTP limiter, `SECURITY_ALERT` on use; staff use forces re-enrolment (A-7).
- [ ] PlatformRole and seller OWNER/MANAGER permissions inactive until 2FA enrolled; sessions need `secondFactorVerifiedAt` (ADR-0002 §3, A-5).
- [ ] Step-up (10 min `reauthenticatedAt`, password/OAuth + TOTP) on the ADR-0002 §4 list; tested for each action.

### 10.5 Authorization framework
- [ ] **[B]** `defineAction()` cannot be built without a permission and a rate-limit key; CI route/action registry test fails on unregistered handlers (P-1, D-1, G-2).
- [ ] **[B]** Authz matrix tests per ADR-0003 §5 including cross-seller cases derived from the resource (P-2), no self-grant, AI/RULE principal cannot create SUSPENSION/BAN (P-9).
- [ ] No cross-request caching of `ActorContext` (P-10).
- [ ] Role grant/revoke revokes the target's sessions; four-eyes for ADMIN/SUPER_ADMIN grants is at least designed (P-3, lands M6).

### 10.6 Request-level protections
- [ ] **[B]** Central `assertSameOrigin` on every non-GET handler/action; reject missing or `null` Origin when `Sec-Fetch-Site` is not same-origin (A-10).
- [ ] **[B]** Rate-limit registry (§5) with fail-open/closed policy per entry (auth entries fail closed), trusted-proxy count for `X-Forwarded-For` (D-1, D-2, G-3). Evidence: registry coverage test.
- [ ] CAPTCHA escalation after 3 failures; no hard lockout (D-6).
- [ ] `returnTo` accepts relative allow-listed paths only (A-13).
- [ ] Headers: nonce CSP, `frame-ancestors 'none'`, HSTS, `nosniff`, `Referrer-Policy`; header test in CI (X-1, X-8).
- [ ] No `dangerouslySetInnerHTML` (lint rule) and no `$queryRawUnsafe` (SAST rule) (X-1, X-2).

### 10.7 Audit and data
- [ ] Auth events audited (login ok/fail, 2FA change, session revoke, password change) with `ipHash`/`userAgent`; `ipHash` is a keyed HMAC (X-9, A-12).
- [ ] App DB user has INSERT/SELECT only on `audit_logs`; migrator user separate (P-6, G-6).
- [ ] DTO mappers: no `passwordHash`, `tokenHash`, TOTP fields, `ipHash` in any response; test with a field deny-list (X-5).
- [ ] Email templates contain no user-supplied links; SPF/DKIM/DMARC configured for the sending domain (X-7). Notification for new-device login and credential change.

### 10.8 Secrets and supply chain (M2 baseline)
- [ ] **[B]** Secret scanning + push protection enabled; CI secret-scan job green on full history (X-3).
- [ ] **[B]** Env schema validation at boot; separate values per environment; no `NEXT_PUBLIC_` secret (R-S4).
- [ ] Branch protection, CODEOWNERS, read-only default workflow token, no `pull_request_target` on untrusted code (R-S2, §9.4).
- [ ] `pnpm audit` / OSV and Dependabot enabled; lockfile committed; Argon2 binding version pinned (X-4).
- [ ] Redis requires auth, not publicly reachable (MT-1).
- [ ] Token inventory started: every token documented with owner, scope, expiry (§9.4, §9.5).

### 10.9 Verification
- [ ] Auth abuse tests: credential stuffing against login limiter, pending-session attempt cap, recovery-code brute force, reset-token reuse, OAuth pre-takeover, fixation.
- [ ] Manual security review of the M2 diff by the Security Engineer before merge; findings tracked as bugs with severity per §2.
