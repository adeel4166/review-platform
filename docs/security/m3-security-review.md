# M3 security review and sign-off (task #51, M3-08)

| | |
|---|---|
| **Owner** | Security Engineer (QA_SECURITY) |
| **Branch** | `task/51` |
| **Scope** | M3-02 (#45), M3-03 (#46), M3-04 (#47), M3-05 (#48), M3-06 (#49), and the QA gate M3-07 (#50) as evidence |
| **Against** | [threat-model.md](./threat-model.md) §3.3 (O-1 to O-8), P-2, F-5; the M3 carry-overs in [m2-security-review.md](./m2-security-review.md); ADR-0014 to ADR-0017 |
| **Method** | Static review of the code listed per finding. `pnpm audit --prod` (clean), a secret-pattern grep over tracked files (no hits), reading the QA gate report. No exploitation, no runtime stack (MySQL, Redis, MinIO, Mailpit are not available in this sandbox) |

## 1. Sign-off decision

**Security sign-off for M3a: GRANTED, conditional.** There are **no open Critical or High findings**. Nothing needs CEO risk
acceptance.

The conditions are the fix tasks in §3. Three are Medium and must be filed (F-01 to F-03). F-01 and F-02 must be closed
**before claims or invitations are enabled for real users outside staging**. F-03 must be closed before the first real
META_TAG claim is accepted in production. The remaining findings are Low or Info and may be scheduled.

This sign-off covers the M3a scope (sellers, memberships, invitations, DNS_TXT and META_TAG claims, staff claim queue, email
verification). It does **not** cover:

- ownership transfer with 2FA and seller replies (M3b, [ADR-0017](../adr/0017-defer-ownership-transfer-and-seller-replies.md)). QA's SEL-006 deferral is accepted by Security as safe (see §5),
- `BUSINESS_EMAIL_DOMAIN`, which returns 501 (`apps/web/src/server/claims.ts:50`). The domain policy for it is reviewed here, the flow is not,
- runtime behaviour (see "Limits" at the end).

## 2. Findings by severity

| ID | Severity | Title | Where |
|---|---|---|---|
| F-01 | Medium | Verification egress is not isolated: the SSRF fetcher runs inside the core worker, next to DB, S3 and SMTP secrets | `apps/worker/src/processors.ts:65-77`, `apps/worker/src/main.ts` |
| F-02 | Medium | Account pre-hijacking through unverified registration, which also reaches invitation acceptance | `apps/web/src/server/registration.ts:90-114`, `email-verification.ts:24-42`, `sellers.ts:164-186` |
| F-03 | Medium | META_TAG falls back to `https://www.<domain>/`, so a dangling `www` host can prove ownership of the apex | `apps/worker/src/verification/checks.ts:25-35` |
| F-04 | Low | Admin who is a member of a seller can suspend or unsuspend it (no conflict-of-interest guard) | `apps/web/src/server/sellers.ts:229-257` |
| F-05 | Low | `STAFF_APPROVE` does not re-check seller state or claimant membership, and trusts evidence that can be days old | `packages/core/src/claim-service.ts:176-203` |
| F-06 | Low | Moderator tiers only half done (SEC-09(e)): `MODERATOR`/`SENIOR_MODERATOR` are grantable but inert; role-grant guards are loose | `apps/web/src/server/auth.ts:15-19`, `staff-roles.ts` |
| F-07 | Low | Unverified sellers publish a free-text description and a clickable website link; name-similarity only compares to VERIFIED sellers | `apps/web/src/app/sellers/[slug]/page.tsx`, `sellers.ts:101-107` |
| F-08 | Low | Invitation token travels inside the login `callbackUrl` | `apps/web/src/components/seller/AcceptInvitation.tsx:16` |
| F-09 | Low | Carry-overs still open: SEC-07 runtime check, `content-type` signing, prompt-injection review | m2-security-review.md |
| F-10 | Info | Smaller observations (limiter scope, PSL subset, audit `reason`, no OWNER recovery path, evidence URL) | §2.4 |

### 2.1 Medium

#### F-01 Verification egress is not isolated (O-5, SEC-016, ADR-0015 §Isolation)

- **Evidence.** The spec (§6.7) and ADR-0015 require a `verification-egress` worker group whose environment has only
  `REDIS_URL` and `VERIFY_DNS_SERVERS`, a startup assertion that no `DATABASE_URL`/S3/SMTP secret is present, and a network
  policy. None of that exists: `grep verification-egress` finds no code, and `apps/worker/src/processors.ts:65-77` runs
  `createProductionFetcher` inside the same process that holds the Prisma client, S3 and SMTP credentials. There is no
  `WORKER_GROUPS` switch.
- **What holds up.** The in-app control, which the spec calls the primary one, is sound (see §4, O-5). The fetch result is
  never returned to a user (only a bounded token comparison), so the residual class is **blind SSRF**.
- **Impact.** If a future change or an unknown bypass lets the fetcher reach an internal host, the request is made from a
  process that can reach the database, Redis, object storage and the metadata endpoint, with no second line of defence.
  Likelihood is low, impact is bounded to blind GETs, hence Medium and not High.
- **Fix (task for PM, DevOps + Backend).** Split the verification consumer into its own process or group; startup asserts the
  environment contains no `DATABASE_URL`, `S3_*`, `SMTP_URL`; Redis ACL limited to its queue keys; egress network policy
  (TCP 80/443 to the internet except RFC 1918, CGNAT, link-local, metadata and cluster ranges; DNS only to
  `VERIFY_DNS_SERVERS`). Add the startup-assertion test.

#### F-02 Account pre-hijacking (also reaches invitation acceptance)

- **Evidence.** `registerAccount` creates an account for any email, with the attacker's password, and mails a verification link to
  the **victim** (`registration.ts:98-103`). Login is allowed while unverified (`auth.ts:authorizeCredentials` checks only
  `status`). When the victim clicks "Confirm email", `verifyEmailToken` sets `emailVerifiedAt` on that account
  (`email-verification.ts:35`) and nothing changes the credentials. The attacker's password now opens a **verified** account
  bound to the victim's address. Sessions are not invalidated either.
- **Reach.** A verified account can accept invitations addressed to that email (`sellers.ts:164-186`). If the victim is later
  invited to a seller (for example as MANAGER), the attacker, not the victim, can take the seat. It also makes the
  `claimantEmailVerified` auto-approval precondition (`claim-service.ts:164`) weaker than intended.
- **Why SEC-05 is still closed.** The enumeration oracle is gone. This is a different, pre-existing class that the verify
  step now makes exploitable. It needs the victim to click a mail they did not ask for.
- **Fix (task for PM, Backend).** Choose one (Security prefers 1 + 3):
  1. On verification, force the user to **set a new password** when the account was created by a password registration and
     verification happens without a fresh authenticated session proving knowledge of the registration password; at minimum,
     rotate `passwordHash` through a "choose password" step on the verify page.
  2. Do not let an unverified account log in, and purge unverified accounts after 7 days so the email can be re-registered.
  3. Bump a session version on verification so any session created before it is rejected (`jwt` callback in `auth.ts`).
  Add a regression test: register with victim email, victim verifies, attacker's old password and old session must not work.

#### F-03 META_TAG `www` fallback and subdomain takeover (O-1, O-4)

- **Evidence.** `observeMeta` tries `https://<domain>/` and then `https://www.<domain>/` and accepts the first page with a
  token (`checks.ts:27-33`). A dangling `www` CNAME to an unclaimed third-party tenant (a common subdomain takeover) lets an
  attacker publish the meta tag and be auto-approved as owner of the **apex** brand domain. `finalMustBeInside` only checks
  that the final host is inside the domain, which any takeover host satisfies. Only 10 % of such claims get a spot-check.
- **Impact.** Fraudulent ownership of a brand (O-1 is rated Critical for impact). Likelihood is low to medium, so Medium.
- **Fix (task for PM, Backend).** Drop the `www` fallback (a site that exists only on `www` uses DNS_TXT), or keep it but force
  `requiresHumanReview` and a 100 % spot-check when the proof came from `www`. Record the proof host on the claim for the
  reviewer. Add a test that a token on `www` alone does not auto-approve.

### 2.2 Low

- **F-04 Seller suspension COI (ADR-0003, enforcement guard).** `suspendSeller` and `unsuspendSeller` check only the admin
  tier. An ADMIN who is a member of seller X can lift a suspension another admin imposed on X, or suspend a competitor
  they are not a member of without any second approval. Claim decisions have the COI guard
  (`claim-service.ts:178-179`); enforcement does not. **Fix:** reject when the actor is a member of the seller (reuse
  `ClaimConflictOfInterestError`-style code `CONFLICT_OF_INTEREST`); require a second staff actor to **unsuspend**.
- **F-05 Staff approval skips state re-checks.** `canAutoApprove` checks `sellerBlocked`, claimant is OWNER/MANAGER and the
  claimant's email is verified, but `STAFF_APPROVE` does none of these. A claim whose seller was suspended or closed, or
  whose submitter was removed from the seller, can still be approved and PRODUCT claims then rewrite `product.sellerId`
  (`claim-service.ts:127`). For CONTESTED claims the "PASS" used at the final approval can be 7 or more days old
  (`contestResponseMs`), so a domain that changed hands in between is still approved. **Fix:** apply the same
  seller/claimant checks in `STAFF_APPROVE`; for auto-methods require `lastCheckAt` within 24 h at the final approval or
  enqueue a fresh check first.
- **F-06 Moderator tiers (SEC-09(e) is only partly closed).** `roleFrom` maps `SUPER_ADMIN`, `ADMIN` and everything else to
  `super_admin | admin | user` (`auth.ts:15-19`). `MODERATOR` and `SENIOR_MODERATOR` can be granted through
  `/api/admin/staff/[id]/roles` but have no effect. That fails closed (no exposure), but the M3-02 closure text overstates
  it. Also: `grantStaffRole` does not require the target to be `ACTIVE` with a verified email; the "at least 2 SUPER_ADMINs"
  count in `revokeStaffRole` is read without a lock, so two concurrent revocations can both pass; ADR-0003 step-up is absent
  (waits for 2FA, M8). The positive side: roles are re-read from the database on every session read (`auth.ts` `jwt`
  callback), so a revocation applies immediately. **Fix:** see §3 task T-06.
- **F-07 Pre-verification public content (O-3, O-7).** Any verified-email user can create a seller with any name. Until
  verified, the public page shows the free-text description and a `websiteUrl` link (`rel="nofollow noopener noreferrer ugc"`,
  http(s) only, so no `javascript:` risk). The name-similarity flag compares only to VERIFIED sellers
  (`sellers.ts:102-107`), not to product `brandName`s. **Fix:** do not render the website link or description until the
  seller is VERIFIED (or until staff approve), add `noindex` for non-VERIFIED seller pages, extend the similarity check to
  brand names. The "Unverified" label and server-derived badge (`seller-views.ts`) are correct.
- **F-08 Invitation token in the login URL.** `AcceptInvitation.tsx:16` builds `/login?callbackUrl=/invitations/accept?token=…`.
  The accept page sets `referrer: no-referrer` and the callback is same-origin only, but the token now sits in two URLs that
  proxies and analytics log. The verify-email page does it better (no login hop). **Fix:** keep the token in
  `sessionStorage` before the login redirect, or put it in the URL fragment; scrub request logs for `token=` in the M8 runbook.
- **F-09 M2 carry-overs not closed in M3-02.** The M3 spec lists "SEC-07 runtime check" under M3-02, but the M3-02 closure
  table does not mention it and the QA gate does not run it: (1) signed `content-length` against real MinIO/R2,
  (2) `content-type` is still not signed, (3) PUT URL validity after confirm, (4) ingest bucket CORS and 24 h lifecycle.
  The real-LLM prompt-injection review is still open because no real classifier exists yet. **Fix:** tasks T-08 and T-09.

### 2.3 Items checked and found sound (no finding)

- Claim challenge: 256-bit random, unique index, compared with `timingSafeEqual`, only against **this** claim's value,
  never after expiry (`claims.ts:37, 54-61`). A token placed for claim X cannot satisfy claim Y.
- State machine: the only writer of `status` is `applyClaimTransition`; the claim and both sellers are locked, everything is re-read,
  transitions are table-checked, no row change or audit row on an invalid transition (`claim-service.ts:72-81`). DB
  uniqueness on `verifiedDomainKey` and `activeKey` backs it up (`schema.prisma:569-570`).
- Auto-approval requires all of: auto method, SELLER scope, PASS, no human review, no conflict, OWNER/MANAGER claimant with
  verified ACTIVE account, seller not blocked, unexpired challenge (`claims.ts:107-112`). PRODUCT, DOCUMENT and MARKETPLACE
  claims are never machine-approved.
- Contest: a PASS on a domain with a VERIFIED incumbent becomes CONTESTED with two approvals and no auto-approval
  (`claim-service.ts:101-111, 155-156`). The incumbent's OWNERs are mailed through the outbox (`notify.ts`); the mail leaks no
  claimant identity or evidence. The incumbent is revoked only after two distinct staff approvals and after the 7-day
  window (`claim-service.ts:184-201`).
- Four-eyes: staff cannot decide their own claim (`SelfDecisionError`), members of the claiming or conflicting seller get
  `CONFLICT_OF_INTEREST`, and the same reviewer cannot approve twice (`DuplicateApprovalError`).
- Cross-seller IDOR (P-2): every seller route derives the seller from the path or from the loaded row (claim, invitation),
  never the body; bodies are `.strict()`; non-members get 404, not 403 (`sellers.ts:51-69`, `claims.ts:128-132`,
  `sellers.ts:189-194`, `seller-views.ts:45-47, 50-55`). The table-driven matrix in `sellers.test.ts` and the QA gate cover
  every permission x role. Suspension is read from the database on every call.
- Evidence URLs (`https` only) are stored and never fetched. The only server-side fetch of a user-influenced name is the
  claim domain, built server-side into `https://<domain>/`. This keeps the U-10 "no server-side fetch of user URLs" policy.
- Admin routes use `requireAdmin` / `requireSuperAdmin`; the auto-discovering authz matrix (`admin-authz.test.ts`) covers the new
  routes (per QA gate).

### 2.4 Info observations

1. **R-1 closure verified.** `login`, `register` and `verify-email` limiters use `"closed"` with a per-process fallback and an
   error hook (`ratelimit.ts`). With N web replicas the effective fallback limit is N x the configured one, which is acceptable.
   `limitVerifyEmail` (30/h/IP) is shared by token confirm, resend and invitation accept; a shared NAT can lock itself out.
   Not a security issue.
2. **Public suffix table is a subset (M3-Q7).** `domain-policy.ts` classifies by a pinned subset. It fails **closed**: an unlisted
   multi-label suffix makes `x.y.z` look like a subdomain (rejected). The only risk is a legitimate rejection. Swap to a full
   PSL snapshot when scheduled.
3. **Audit `reason` is free text** by design (`audit-metadata.ts`). Reviewers may type personal data; add a UI hint and length cap (already capped at 255).
4. **No OWNER recovery path.** Invitations cannot grant OWNER, and the last OWNER cannot leave. A seller whose single OWNER loses
   their account cannot be recovered without staff. Needs a runbook or an admin "assign owner" with step-up (M3b).
5. **Evidence URL in the staff API** (`getClaimForStaff`) is not rendered in the UI today. When it is, render as inert text first,
   `rel="noopener noreferrer"`, show punycode, never auto-fetch or preview.
6. **Registration timing.** Both paths hash the password; the existing-email path skips three DB writes. Residual timing
   difference is small and the endpoint is throttled. The `handle_taken` 409 is a handle oracle only, and handles are public.

## 3. Fix tasks the PM must file

| Task | From | Priority | Owner | Description | Must be done |
|---|---|---|---|---|---|
| **T-01** | F-01 | Medium | DevOps + Backend | Implement the `verification-egress` worker group: separate consumer, env assertion (no DB/S3/SMTP secrets), Redis ACL, network policy, startup-assertion test | Before claims are enabled outside staging |
| **T-02** | F-02 | Medium | Backend | Close pre-hijacking: force password choice or session-version bump on first email verification, purge stale unverified accounts, regression test | Before invitations or claims are enabled outside staging |
| **T-03** | F-03 | Medium | Backend | META_TAG: remove the `www` fallback or force human review + 100 % spot-check, record proof host, test | Before the first production META_TAG claim |
| T-04 | F-04 | Low | Backend | COI guard and second actor for `suspendSeller` / `unsuspendSeller`; test | M3b |
| T-05 | F-05 | Low | Backend | `STAFF_APPROVE`: re-check seller not SUSPENDED/CLOSED and claimant still OWNER/MANAGER; fresh check (< 24 h) for auto-method approvals; tests | M3b |
| T-06 | F-06 | Low | Backend | Wire `MODERATOR`/`SENIOR_MODERATOR` tiers into `roleFrom` and guards (or remove them from `STAFF_ROLES` until M6); target must be ACTIVE with a verified email; lock the SUPER_ADMIN count; correct the M3-02 closure wording | M6 (tiers), M3b (guards) |
| T-07 | F-07, F-08 | Low | Backend + Frontend | Hide website link and description until VERIFIED, `noindex` for non-VERIFIED sellers, similarity vs product brand names; remove the token from the login callback URL | Before public launch |
| T-08 | F-09 | Medium | QA + DevOps | Run the SEC-07 runtime check on MinIO and R2 (signed `content-length`, PUT after confirm, bucket CORS, 24 h lifecycle); decide on signing `content-type` | M3b for MinIO, before launch for R2 |
| T-09 | F-09 | Low | Backend | Prompt-injection review and canaries (SEC-008) when the real LLM moderator lands | M6 |
| T-10 | Info 2 | Low | Backend | Replace the PSL subset with a pinned full snapshot (M3-Q7) | M3b |

T-01 to T-03 are the only items gating real-user exposure. No finding blocks M3a in staging.

## 4. Threat-model coverage (section O, P-2)

| ID | Status after M3a | Basis |
|---|---|---|
| O-1 | **Covered**, residual F-03, F-05 | Conflict scan and CONTESTED flow, two approvals for brands with a claim, high volume or name flag, DOCUMENT/MARKETPLACE always human, per-claim 256-bit challenge, incumbent mailed, unique `verifiedDomainKey` |
| O-2 | **Covered in policy, flow not built** | `assertOwnableDomain` rejects private suffixes, shared hosts and free-mail, MX check exists. `BUSINESS_EMAIL_DOMAIN` returns 501. The "link bound to session user" requirement must be re-reviewed when the flow is built |
| O-3 | **Covered** | Punycode domain shown from server state only, similarity flag, 10 % spot-check. Residual F-07 |
| O-4 | **Covered** | Monthly DNS/META re-check, 14-day grace, downgrade with `seller.downgraded` notice, 12-month rolling validity for other methods |
| O-5 | **Covered in-app, isolation missing (F-01)** | See below |
| O-6 | **Partly covered, transfer deferred (M3b)** | Invitations: bound to the verified invitee email, 256-bit token (hash stored), 7-day expiry, single use by one atomic conditional update, OWNER not grantable, rate limits. Transfer, 2FA and 72 h delay are not built (ADR-0017). Residual F-02 |
| O-7 | **Partly covered** | Badge only from server state (`VERIFIED` + claim id + domain). Similarity check limited to VERIFIED sellers (F-07) |
| O-8 | **Not exercised** | No evidence documents are uploaded in M3a (`evidenceUrl` only). Re-review with the document pipeline (M5) |
| P-2 | **Covered** | See §2.3 |

**O-5 detail (reviewed in `safe-fetch.ts` and `domain-policy.ts`).** Per hop: scheme http/https only, no userinfo, port must be the
default of the scheme, host passes `normalizeHostname` (rejects every IP-literal notation, single-label and special-use TLDs),
A and AAAA resolved through public resolvers, **every** answer must be public unicast (`isPublicAddress`: IPv4 deny table,
v4-mapped and NAT64 unwrapped, global unicast `2000::/3` only), connection goes to the pinned address through a custom `lookup`
that never resolves again, the connected socket address is re-asserted, TLS verified with SNI, redirects re-validated per hop
(max 3, no https to http downgrade), `finalMustBeInside` for META, one 5 s budget over DNS, connect, TLS and body, 1 MB cap
(declared and streamed), identity encoding only, HTML content types only, no cookies, no body in error details. The test-only
allowlist is a constructor argument that the production factory never sets. I found no bypass in the code. The QA corpus
(zero bypasses, 15 added encodings) agrees.

## 5. Specific questions in the task

- **Ownership-proof bypasses.** None found that need less than control of the domain's DNS or its web root. The practical gaps
  are a taken-over `www` host (F-03) and stale evidence at staff approval (F-05).
- **SSRF in the verifier.** Fetcher sound; isolation missing (F-01).
- **Invitation and membership takeover.** Invitation logic is sound (§4 O-6). The takeover path is through a pre-hijacked
  verified account (F-02). Membership removal is OWNER-only and cannot remove the last OWNER (row lock). Since OWNER cannot be granted,
  there is exactly one OWNER per seller until M3b, which also means a single point of failure (Info 4).
- **Cross-seller IDOR.** None found (§2.3).
- **Email-verification token handling.** Sound: 256-bit, only SHA-256 stored, single use by atomic conditional update,
  bound to the account's current email, 24 h, GET never consumes (scanner-safe), `no-referrer`, one generic error for every failure,
  resend invalidates older tokens and is limited per user (3/h, 10/day) and per IP, link base from `APP_URL` not the
  Host header, raw token never stored or logged by the worker. Watch item: the worker's retry extends `expiresAt` (bounded by
  retries) and the URL carries the token, so edge logs must scrub `token=` (M8 runbook).
- **SEC-05 closure.** **Closed** (Medium to closed). Same status and body for new and existing email, hashing on both paths,
  "account exists" mail limited to one per hour, throttled per IP. Residual F-02 and Info 6.
- **R-1.** **Closed** (Info 1).
- **Moderator tiers (SEC-09(e)).** **Partly closed**: SUPER_ADMIN/ADMIN split works, with no self-change, minimum two
  SUPER_ADMINs and a test matrix. MODERATOR/SENIOR_MODERATOR are inert (F-06). SEC-09(c) is **closed** (runtime guard in `transitionCase`,
  claim and staff-role audits, plus a static scan of every `metadata:` literal). Gitleaks CI is **closed**
  (full history, no fixture allowlist); a secret-pattern grep of tracked files found nothing. SEC-12 stays "no issue".

## 6. Remaining work by milestone

### M3b (already deferred by ADR-0017, plus carry-over)

- Ownership transfer (SEL-006): 2FA for **both** parties, 72 h delay, notification to all OWNERs, cancel link, audit; OWNER grant by
  invitation must stay impossible until then. Requires the 2FA build from ADR-0002 (SEC-09(d)).
- Seller replies (F-5) with a **link policy**: no links or allow-list only, no contact details, markdown disabled or
  sanitised, rate limit, moderation through the same AI-first pipeline, `SELLER_REPLY_RESTRICTION` enforcement, reply
  authorisation derived from the review's product to seller mapping (P-2 reply clause, AZ-010 reply part).
- T-04, T-05, T-10, SEC-07 MinIO runtime check (T-08).
- `BUSINESS_EMAIL_DOMAIN` flow (currently 501) with the verification link bound to the session user, plus re-review of O-2.
- Incumbent response channel for contested claims (today staff-only).

### M8 (hardening and launch)

- SEC-09(d): admin 2FA, short admin session and step-up for role grants, `BAN` and `SELLER_SUSPENSION`.
- R-2 forwarded-header trust and the `token=` log scrubbing in the deploy runbook; HSTS at the edge.
- Egress proxy option for the verifier (M3-Q13) on top of T-01; sharp/worker memory and CPU limits; R2 bucket policy.
- Real evidence-document pipeline controls (O-8) when documents are accepted (M5), retention purge after decision.
- Alerting on `ratelimit_backend_error_total`, on `claim.verified` spikes and on spot-check failures.

## 7. Limits of this review

Static review plus the unit/integration evidence in the QA gate report. Not run here: Playwright seller specs, the real DNS and
HTTP egress path, Redis fault injection, MinIO/R2, SMTP delivery, browser CSP behaviour. They rely on CI and on tasks T-01
and T-08. The sign-off applies to the code at the head of `task/51` (merge of task/50).
