# M3b + M4 security review (task #73, SEC-M3b-M4)

| | |
|---|---|
| **Owner** | Security Engineer (QA_SECURITY) |
| **Branch** | `task/73` |
| **Scope** | M3b fixes from task #64 (2FA failure alerting, ownership-transfer cancel tokens and reminder, business-email MX enforcement) and the M4 backend from task #68 (votes, review edits and revisions, reporting, Verified Buyer purchase proof) |
| **Against** | [threat-model.md](./threat-model.md) (O-5, F-5 and the M4 abuse rows), [m3-security-review.md](./m3-security-review.md), [verification-egress.md](./verification-egress.md), [ingest-bucket-hardening.md](./ingest-bucket-hardening.md), ADR-0008, ADR-0019, ADR-0020, ADR-0022, `docs/architecture/m3b-spec.md`, m4-m5-spec |
| **Method** | Static review of the code cited per finding. `pnpm audit --prod`: no known vulnerabilities. Secret-pattern grep over tracked files: no hits. No exploitation and no runtime stack (MySQL, Redis, MinIO and Mailpit are not available in this sandbox). Nothing in this document quotes a secret or `.env` value. |

## 1. Decision

**Launch-blocking issues (P0): none. Result: PASS.**

There are **no P0 defects**, so there is no `SEC-M4-xx` P0 item for the M4 QA gate (#71) to check. The result is a PASS with
conditions: **two P1 findings must be closed before real users are onboarded** (not before staging):

- **SEC-M3B-01**: `auth.security_alert` has no consumer, so none of the mandatory 2FA/recovery alerts is ever emailed.
- **SEC-M4-01**: the IP hash key silently falls back to a public default, so stored `ipHash` values are reversible.

The remaining findings are P2 (hardening or abuse-resistance gaps with bounded impact). Severity scale used here:

| Level | Meaning |
|---|---|
| P0 | Exploitable now, or breaks a launch-gating control with serious impact. Blocks launch. |
| P1 | A required control is missing or weak. Must be fixed before real-user onboarding; no direct exploit path shown. |
| P2 | Hardening, abuse bounded by other controls. Schedule. |

Not covered: runtime behaviour (S3 policy, R2 lifecycle, real SMTP, real Redis failure modes), the OCR/PDF rasteriser (M5-02,
not yet in the tree), and seller replies (M3b scope, reviewed separately if required).

## 2. Findings table

| ID | Sev | Title | Where |
|---|---|---|---|
| SEC-M3B-01 | P1 | `auth.security_alert` events have no worker consumer: 2FA failure, recovery-code and 2FA-disabled alerts are never sent | `apps/worker/src/outbox.ts:48`, `apps/worker/src/processors.ts:96-116` |
| SEC-M3B-02 | P2 | Alert trigger can be skipped by parallel guesses (`failures === 3`) and the hourly dedupe is check-then-insert | `apps/web/src/server/two-factor.ts:130-139` |
| SEC-M3B-03 | P2 | Per-account "attempt" limiter lets a password-holder lock the victim out of sign-in 2FA and step-up | `apps/web/src/server/ratelimit.ts:70-75` |
| SEC-M3B-04 | P2 | Cancel-by-link token has no expiry of its own, survives membership/account changes, and the cancel is not attributed | `apps/web/src/server/ownership-transfers.ts:263-278` |
| SEC-M3B-05 | P2 | Egress worker start-up guard is a deny-list of env names, not an allow-list | `apps/worker/src/groups.ts:9-10,24-28` |
| SEC-M3B-06 | Info | MX enforcement and egress policy: verified correct (see §4.3) | `apps/worker/src/verification/checks.ts:35-48,126-148` |
| SEC-M4-01 | P1 | `hashIp` falls back to a public default key; no boot-time assertion, no documented variable | `packages/core/src/reports.ts:14-18` |
| SEC-M4-02 | P2 | Vote write is read-then-write outside the transaction: concurrent identical PUTs double-apply counter deltas | `apps/web/src/server/votes.ts:48-57` |
| SEC-M4-03 | P2 | Revision history for staff is readable without the 2FA-verified staff gate | `apps/web/src/server/reviews.ts:139-143`, `apps/web/src/app/api/reviews/[id]/revisions/route.ts:9` |
| SEC-M4-04 | P2 | `rejectReport` has no conflict-of-interest guard and no case-state check | `apps/web/src/server/reports.ts:131-143` |
| SEC-M4-05 | P2 | Reports from members of the reviewed seller carry full weight; no per-target throttle | `apps/web/src/server/reports.ts:21-28` |
| SEC-M4-06 | P2 | Edits of PENDING/HIDDEN reviews are not throttled beyond the generic write limit (moderation churn) | `apps/web/src/server/reviews.ts:79-101`, `apps/web/src/app/api/reviews/[id]/route.ts:16` |
| SEC-M4-07 | P2 | Proof upload hygiene: unbounded slot churn, no pixel cap, no AV scan, parser sandboxing for the future PDF path | `apps/web/src/server/proofs.ts:81-83`, `apps/worker/src/proofs.ts:36,57-73` |
| SEC-M4-08 | P2 | Staff proof queue: no view-rate limit or anomaly alert, VERIFIED decision needs no step-up | `apps/web/src/server/proofs.ts:171-228`, `apps/web/src/app/api/admin/proofs/[id]/decide/route.ts:9` |
| SEC-M4-09 | P2 | Retention: no erasure path for proofs on account deletion, unvalidated retention env, tombstone hashes kept indefinitely | `apps/web/src/server/proofs.ts:201`, `apps/worker/src/proofs.ts:184-226` |
| SEC-M4-10 | P2 | Fail-closed redactor makes every image solid black and every PDF fail: staff decide on hints only | `apps/worker/src/proofs.ts:33-40` |
| SEC-M4-11 | Info | Defence-in-depth notes (swallowed Origin error, `RATE_LIMIT_ENABLED`) | §3.3 |

## 3. Findings

### 3.1 M3b

#### SEC-M3B-01 (P1) No consumer for `auth.security_alert`

- **Evidence.** The web app emits `auth.security_alert` for `TWO_FACTOR_ENABLED`, `TWO_FACTOR_REPLACED`, `TWO_FACTOR_DISABLED`,
  `RECOVERY_CODE_USED`, `STAFF_RECOVERY_USED` and `SECOND_FACTOR_FAILURES` (`two-factor.ts:39-40,118,121,138,198,215,247`). The
  outbox maps the type to the notifications queue (`outbox.ts:48`). The notifications processor
  (`processors.ts:96-116`) only branches on verification, invitation, claim, ownership-transfer and proof job names; any other
  name falls through with `outcome = "SKIPPED"` and a success log line. A repo-wide grep finds no handler, template or test for
  `auth.security_alert` outside the producer. QA's AUT-022 check only looked at the producer side.
- **Impact.** m3b-spec §2.5-2.7 makes these mails mandatory ("ignores preferences"). Without them a user is not told that someone
  has the correct password and is guessing codes, that a recovery code was spent, that 2FA was replaced or disabled, or (for staff)
  that a recovery code reset their 2FA (AUT-023). The preventative controls (5-failure session cap, limiter, step-up) still hold,
  so this is a detection gap, not an authentication bypass: P1.
- **Fix.** Add a `auth.security_alert` branch in the notifications processor: load the user, require `ACTIVE` and a verified email,
  render one template per `kind`, send with idempotency key `job.id`, ignore notification preferences. Never include the code,
  secret or IP in the mail. Add a worker test per `kind` and an end-to-end Mailpit test for `SECOND_FACTOR_FAILURES` and
  `STAFF_RECOVERY_USED`. Until then, make the processor throw (or log at error level) on an unknown notification type instead
  of reporting success.

#### SEC-M3B-02 (P2) Alert condition can be missed; dedupe is not atomic

- **Evidence.** After a failed code the handler re-reads the session counter and alerts only when `failures === 3`
  (`two-factor.ts:130-138`). Each attempt reserves its slot atomically (`:99-102`), but the later read is not tied to that
  reservation. Two or more parallel guesses on one pending session can both read 4 or 5, so neither sees exactly 3 and no alert
  is raised. The hourly per-account dedupe (`:135-138`) is a count followed by an insert, so two sessions reaching 3 at the same
  moment both alert (the opposite error, noisy but harmless).
- **Fix.** Use `failures >= 3` together with a race-safe dedupe: a unique key on the outbox row
  (`kind + userId + hour bucket`, insert-ignore) or a Redis `SET NX EX 3600`. Add a concurrency test that fires 5 parallel wrong
  codes and expects exactly one alert.

#### SEC-M3B-03 (P2) Per-account limiter allows lock-out of the victim

- **Evidence.** `limit2fa("attempt")` charges 10 per 15 minutes per account, shared by sign-in verify, enrolment confirm and
  step-up (`ratelimit.ts:70-75`, `two-factor.ts:92,158,174,236`). An attacker who has only the password can create pending
  sessions and spend the account's quota, so the real user's own second-factor check returns 429 for up to 15 minutes, repeatedly.
- **Impact.** Availability only (the limiter fails closed by design, which is the right trade-off for the credential-guessing
  case). It becomes more painful once SEC-M3B-01 is fixed and the user can see why.
- **Fix.** Keep the per-account cap but also keep a separate, smaller reserved bucket for requests from a session that already
  passed the password step from an IP the account has used before, or let the alert mail (SEC-M3B-01) carry a "sign-in temporarily
  paused" notice. Document the trade-off in ADR-0019.

#### SEC-M3B-04 (P2) Cancel-token lifetime and attribution

- **What holds up (verified).** The token is 32 random bytes; only its SHA-256 is stored (`ownership-transfer-email.ts:35-36`,
  schema `tokenHash` is `@unique`, the web side inserts the row with a NULL hash). Redemption is one conditional update on
  `usedAt: null` under the seller lock (`ownership-transfers.ts:273-274`) so it is single use and race safe. Every failure is the
  same 400 (`:26`). The cancel page sets `referrer: no-referrer` and cancels only on an explicit POST from a button
  (`cancel/page.tsx:5`), so mail-scanner prefetches of the GET cannot cancel. The endpoint is rate limited per IP, fail closed
  (`ratelimit.ts:78`). The request mail is sent per OWNER and for the target, the reminder re-mints the hash of unused rows, which
  invalidates the earlier link, and the reminder job id is deterministic (`processors.ts:113`).
- **Gap 1: expiry.** There is no `expiresAt`. The token lives as long as the transfer is `PENDING`/`ACCEPTED` (at most
  `executeAfter` + sweep, 7 days to accept). That is acceptable, but it is implicit; a transfer left `ACCEPTED` because the
  execute job is down keeps live tokens.
- **Gap 2: recipient state is not re-checked.** At redemption (`:265-277`) the recipient is not re-validated: a recipient who was
  removed from the seller, deactivated, or who lost the mailbox keeps a working cancel credential until the transfer ends. Cancelling
  is protective, so the risk is nuisance (a removed ex-owner can cancel a legitimate change) rather than takeover.
- **Gap 3: attribution.** `end(...)` is called with `endedById` unset and a SYSTEM actor (`:275`), so the audit row does not say
  which recipient's link was used.
- **Fix.** Add `expiresAt = transfer.executeAfter + 24 h` (set at mint time) and check it; at redemption require the recipient to
  still be `ACTIVE` and either still an OWNER or the target; pass `endedById: tok.recipientId` and add `recipientId` to the audit
  metadata. Test: removed owner's link returns the generic 400.

#### SEC-M3B-05 (P2) Egress worker guard is a deny-list

- **Evidence.** `forbiddenEgressEnv` rejects `DATABASE_URL`, `SMTP_URL`, `AUTH_SECRET`, the 2FA key variables and `S3_*`
  (`groups.ts:9-10,24-28`). It does not cover variables added later or already present, for example the order-reference HMAC keys,
  the IP hash key (SEC-M4-01), AI provider keys, `AWS_*`, or `REDIS_*` credentials that grant more than the queue keys. The egress
  process fetches attacker-chosen URLs, so any secret in its environment is exposed to a bypass.
- **Fix.** Invert it: allow only `REDIS_URL`, `VERIFY_DNS_SERVERS`, `WORKER_GROUPS`, `WORKER_CONCURRENCY`, `NODE_ENV`, `PATH`,
  `HOME`, `LANG`, `TZ` (and the platform's own vars), and fail start-up on anything else matching a secret-looking pattern
  (`*_KEY*`, `*_SECRET*`, `*_TOKEN*`, `*_PASSWORD*`, `*_URL`). Keep the existing test and add one for an unknown secret name.

#### SEC-M3B-06 (Info) MX enforcement: verified

See §4.3. No defect.

### 3.2 M4

#### SEC-M4-01 (P1) `hashIp` default key

- **Evidence.** `hashIp(ip, key = process.env.IP_HASH_KEY ?? "dev-ip-hash-key")` (`packages/core/src/reports.ts:16`). There is no
  boot-time assertion (compare `assertNoAutoVerify` in `proofs.ts:12`), and the variable name appears nowhere else in the tree
  (no env example, no runbook line). Votes and reports persist this value (`votes.ts:53-54`, `reports.ts:43`) and the vote/report
  rate limits key on it.
- **Impact.** If production is deployed without the variable, every stored `ipHash` is an HMAC under a key that is public in the
  repository. The IPv4 space is 2^32, so a database leak or an over-privileged analyst can recover the raw addresses of voters and
  reporters in seconds. The 90-day nulling job (`core-main.ts:95`) limits exposure but does not remove it.
- **Fix.** In production (`NODE_ENV=production`) throw at boot if `IP_HASH_KEY` is missing, shorter than 32 bytes, or equal to
  the dev default; keep the dev default for tests only. Document it in the env example and the deploy runbook, and add it to the
  egress forbidden list (SEC-M3B-05). Consider rotating the key on a schedule, since the hash is only needed for 90 days.

#### SEC-M4-02 (P2) Vote counter race

- **Evidence.** `putVote` reads the previous vote (`votes.ts:48`), then inside the transaction updates the vote row without
  conditioning on the value it read and applies `voteDelta(prev, value)` (`:51-55`). Two concurrent `PUT NOT_HELPFUL` requests that
  both read `prev = HELPFUL` both apply `h -1, n +1`, leaving one vote row and counters off by one per extra request. A first-time
  concurrent PUT hits the `(reviewId, userId)` primary key and returns a 500 rather than a clean retry.
- **Bound.** Each request is charged against `limitVote` (60/h, 20/h for accounts younger than 7 days, 300/h per ipHash), and
  `reconcileVoteCounts` rewrites the counters from the rows daily (`proofs.ts:232-250` in the worker, scheduled at
  `core-main.ts:95`). So an account can skew a review's counters by at most about 60 per hour and the skew is healed within 24 h.
  Counters can transiently go negative. P2.
- **Fix.** Make the change conditional: `updateMany({ where: { reviewId, userId, value: prev }, data: { value } })` and only apply
  the delta when `count === 1`; catch `P2002` on create and re-run once. Alternatively lock the review row (`SELECT ... FOR UPDATE`)
  at the start of the transaction. Add a `CHECK (helpfulCount >= 0 AND notHelpfulCount >= 0)` and a test that fires 20 parallel
  switches.
- **Verified OK.** Self-vote (`votes.ts` in core, `SELF_VOTE`), seller-member vote (`CONFLICT_OF_INTEREST`), unverified or inactive
  voter, active `VOTING_RESTRICTION`, non-PUBLISHED review (same 404 as missing), same-value PUT as a free no-op, own vote only in
  `myVotes`, relative counter increments. **Residual (accepted, Info):** coordinated sock-puppet rings with verified emails are
  not detected; `ipHash` is stored but no job uses it. Recommend a weekly ring-detection query (many accounts, one ipHash, same
  review set) feeding the trust-score signals.

#### SEC-M4-03 (P2) Staff revision history without 2FA gate

- **Evidence.** `GET /api/reviews/:id/revisions` authenticates with `requireUser()` and `listRevisions` treats `admin` and
  `super_admin` as staff by role alone (`reviews.ts:139-141`; route line 9). Every other staff route goes through `requireAdmin()`,
  which adds the 2FA-verified check (`session.ts:26-29`, AUT-023). An admin session that is not 2FA-verified (for example after
  a staff recovery-code reset, `two-factor.ts:113-119`) therefore still reads the full text of pending, held and superseded
  revisions of any review.
- **Fix.** Split the handler: author branch uses `requireUser`, staff branch must call `requireAdmin`. Simplest: if
  `actor.role` is staff and the caller is not the author, call `requireTwoFactor(actor)` before the query. Test: admin without
  verified 2FA gets 403.
- **Verified OK (authz and history).** Edit is scoped to `authorId = caller`; a foreign review is the same 404 as a missing one
  (`reviews.ts:79-84`). The write is guarded on `status` and `currentVersion` (`:95-99`), so a concurrent moderation decision or
  edit is not overwritten. A live edit of a PUBLISHED review keeps the live text and creates a PENDING revision (R1). Open
  revisions and cases are superseded in the same transaction; versions are monotonic. Media attach/detach checks ownership,
  state and the per-review cap per version. **Hardening note (Info):** nothing enforces revision immutability below the
  application; consider a DB trigger or a grant that forbids `UPDATE` of `rating/title/body` on `review_revisions`.

#### SEC-M4-04 (P2) `rejectReport` lacks the COI guard

- **Evidence.** `dismissReports` and `removeReportedContent` call `loadReportCase`, which blocks the content author and members of
  the product's seller (`reports.ts:72-92`). `rejectReport` does not (`:131-143`): any admin can mark an individual report
  `REJECTED`, which decrements the case `reportCount` and `reportWeight`, even if that admin is the review's author or a member of
  the reviewed seller. It also does not check that the case is still open.
- **Impact.** A conflicted admin can quietly drain reports against their own content or their own seller's reviews before
  another moderator looks. It is audited (`report.rejected`), which is why this is P2.
- **Fix.** Load the case through `loadReportCase` (or the same COI check) inside `rejectReport`, and require the case to be an
  open `USER_REPORT` case. Add a test for author-as-admin and seller-member-as-admin.

#### SEC-M4-05 (P2) Report-flow abuse

- **Evidence.** Per-user (20/day) and per-ipHash (50/day) caps, email-verified reporters, one report per reporter per target,
  "new" accounts weighted 0, content never auto-hidden, uniform 202 for new and repeated reports, `details` never logged, queued or
  audited (`reports.ts:14-56`, `limitReport`). These bound brigading well. Gaps: a reporter who is a **member of the seller being
  reviewed** gets the full weight of 1 (`:28`), so sellers can push negative reviews up the human queue; there is no cap on
  reports per target per hour, so a verified-account ring can fill the queue for one review; and `rejectReport` (SEC-M4-04) is the
  only counter-measure, with no consequence for the reporter.
- **Fix.** Weight 0 (and flag `CONFLICT_OF_INTEREST` on the case) when the reporter is a member of the product's seller; add a
  trust signal `REPORT_REJECTED` per rejected report and weight 0 after N rejections in 30 days; cap open reports per target
  (extra reports still recorded but not re-prioritised). Keep rendering `details` as text only in the admin UI (it is
  attacker-controlled, 1000 chars).
- **Accepted (Info).** The removal decision acts on the review's current text while the case was opened against
  `publishedVersion` at report time (`reports.ts:30,37`); if the author edits in between, the moderator should re-read the live
  text. The admin UI should show the version it is deciding on.

#### SEC-M4-06 (P2) Edit churn

- **Evidence.** The 5-per-day edit cap applies only to edits of PUBLISHED reviews (`reviews/[id]/route.ts:16`, `limitReviewEdit`).
  Edits of `PENDING` and `HIDDEN` reviews are limited only by the generic review-write limits, and each one supersedes the open
  case and re-submits to moderation (`reviews.ts:95-101`, T14). A `HIDDEN` (moderator-hidden) review can be re-submitted
  repeatedly to get a fresh AI assessment each time.
- **Impact.** Moderation and AI-provider cost, and probing of the AI classifier by repeated resubmission. No authz impact.
- **Fix.** Count all edits per review (for example 5 per rolling 24 h per review in addition to the per-user cap) and require a
  materially changed body for `HIDDEN` re-submits, or send them to human review after the second attempt.

#### SEC-M4-07 (P2) Proof upload validation and hygiene

- **What holds up (verified).** MIME allow-list (JPEG, PNG, WebP, PDF) and `kind` consistency, 10 MiB cap, at most 5 files, only
  the proof's owner can create a slot or confirm, slots only while the proof is `DRAFT` (`proofs.ts:76-89`). The presigned PUT is
  signed for the declared content type and length, to the **ingest** bucket under `in/proof/<fileId>` (not guessable, never public).
  Uploads are confirmed by the user, then the worker re-validates **by content**: magic bytes versus declared MIME, size, and
  `TYPE_MISMATCH` rejects (`worker/proofs.ts:57-63`); failures delete the ingest object (`:53`). Ingest objects expire after 1 day
  (ingest-bucket-hardening.md), which also covers a late PUT after a purge.
- **Gap 1: slot churn.** The cap counts only slots not in `REJECTED/FAILED/PURGED` (`proofs.ts:81`) and is checked without a
  lock, so a user can keep opening slots, upload junk, get it rejected and open more within the 24 h draft TTL, and parallel
  requests can exceed 5. It is bounded by `limitUploadSlot` and the 1 day lifecycle, so the impact is cost and noise.
  **Fix:** count every non-purged slot toward a hard cap (for example 10 per proof) and take the count inside a transaction.
- **Gap 2: decode limits and scanning.** The proof path calls `sharp(bytes, { failOn: "error" })` with the library's default pixel
  ceiling (`worker/proofs.ts:36`) and does not run the malware scan or `TOO_MANY_PIXELS` check that the media pipeline has
  (`core/media.ts` failure reasons). Originals are stored in the private bucket before any scan (`:71`). **Fix:** set
  `limitInputPixels` explicitly (same value as the media pipeline), run the same AV scan before storing the original, and fail
  closed when the scanner is unavailable (`SCAN_UNAVAILABLE`).
- **Gap 3: PDF path (forward-looking).** PDFs currently always fail (`:35`). When M5-02 adds the rasteriser it will parse
  attacker-controlled PDFs in the `media` group: it must run with no network, a read-only filesystem, CPU and memory limits and a
  timeout, and must output pixels only. Please add this as an acceptance criterion of M5-02.

#### SEC-M4-08 (P2) Staff proof queue controls

- **What holds up (verified).** All three admin routes use `requireAdmin()` (staff role plus 2FA-verified session). Staff never get
  an original: `getProofDetail` selects only `isRedacted: true, status: READY` files and signs them for at most 300 seconds
  (`proofs.ts:178,184`); the original and its ingest key are never signed anywhere in the web app. Every view writes an audit row
  with the proof id and file count. `assertNoCoi` blocks the review's author and members of the seller on view, decide and label
  revoke. A decision is a conditional update (one winner), the label is set in exactly one place with all fields together
  (`:209-215`), duplicate order/file hits only add flags, and `PROOF_AUTO_VERIFY=true` refuses to start. Label revocation requires a
  step-up (`revoke/route.ts:9`). The author-facing list returns no staff identity and no flags, and the order reference is stored
  only as an HMAC, never raw (`:44`), with a fail-closed 503 if the key is missing.
- **Gap.** Any admin can open any proof; there is no per-staff view-rate limit or alert on unusual volume, and approving
  `VERIFIED` (which moves trust signals and the public label) needs no step-up, unlike revocation. Insider risk is contained by
  the audit trail but not detected.
- **Fix.** Per-staff limit on `proof.view_redacted` (for example 200 per hour) with an alert on breach; a weekly report of
  decisions per staff member and per submitter (a staff member verifying many proofs from one submitter); require a step-up for
  `VERIFIED` decisions or for more than N decisions per hour.

#### SEC-M4-09 (P2) Retention, deletion and erasure

- **What holds up (verified).** Drafts expire after 24 h, pending proofs at the 72 h SLA, both with file deletion requested;
  originals are purged at decision by default (`AT_DECISION`, a `proof.purge_requested` job in the decision transaction) or after
  30 days; redacted copies after 90 days; `filesPurgedAt` is set only after a HEAD returns 404 for every key in both buckets;
  `legalHold` blocks purge; withdrawing a proof or deleting the review requests deletion (`reviews.ts:157-158`,
  `proofs.ts:136`). The sweep is idempotent and batched (`worker/proofs.ts:206-226`). Audit metadata carries ids and reason codes
  only.
- **Gap 1: no erasure path.** Nothing enqueues proof-file deletion when a **user account** is deleted or a GDPR erasure request is
  processed; deletion is wired only to review delete and withdraw. Redacted derivatives therefore live until the 90-day mark.
  **Fix:** the account-erasure job must set `filesDeleteRequestedAt` on all the user's proofs (unless `legalHold`) and null
  `merchantName`, `purchaseDate`, `decisionNote` on them.
- **Gap 2: unvalidated retention config.** `PROOF_ORIGINAL_RETENTION` is cast, not validated (`proofs.ts:201`). A typo should not
  silently pick an unexpected branch. **Fix:** parse with an enum at boot and refuse to start on an unknown value.
- **Gap 3: tombstones.** The sha256 of each file and the order-reference hash are kept after purge for duplicate detection
  (`worker/proofs.ts:159`). The hashes are not reversible to the document, but they are personal-data-adjacent. Record the
  retention period and legal basis in the privacy register, or truncate/expire them (for example 12 months).

#### SEC-M4-10 (P2) Redaction readiness

- **Evidence.** The default redactor is fail-closed: every image becomes a solid black PNG with `REDACTION_FULL_MASK` and every PDF
  throws (`worker/proofs.ts:33-40`). That is the correct security posture (PRV-005) and leaks nothing, but until M5-02 ships a
  staff reviewer sees black pages and decides on the AI hints and flags alone, which invites rubber-stamping or an unsafe
  workaround such as signing originals.
- **Fix / launch condition.** Do not enable the Verified Buyer proof flow for real users until the OCR/masking adapter and the
  rasteriser are in and have a test corpus. Until then keep the proof UI behind a flag. Do not add any code path that signs
  `proof/<id>/orig`; the staff test suite should assert that `presignGet` is never called with an original key.

### 3.3 Informational notes (SEC-M4-11)

- `two-factor-routes.ts:53,59` and similar `await readJson(req).catch(() => undefined)` calls swallow every error of `readJson`,
  including the 403 from the Origin check. Cross-origin protection still holds because `middleware.ts:18` rejects cross-origin
  requests first, but the route should not depend on that. Catch only `invalid_json` and `unsupported_media_type`.
- `DELETE` handlers (vote, review) do not call `readJson` and rely on the same middleware. Same note.
- `RATE_LIMIT_ENABLED=false` turns off every limiter, including the fail-closed 2FA ones (`ratelimit.ts:31`). Add a production
  boot assertion that it is not `false`.

## 4. What was reviewed and passed

### 4.1 2FA failure handling (task #64)

Verified: a per-account limiter is charged before any code is checked and fails closed (`two-factor.ts:92`, `ratelimit.ts:70-75`,
10 per 15 min per account, 30 per 15 min per IP); a per-session cap of 5 is reserved atomically with a conditional update before the
check (`:99-106`); TOTP replay and recovery-code single use are conditional updates (race safe, `:59-70`); a wrong code never
reveals which factor failed; staff recovery drops the secret and revokes other sessions (`:113-119`); audit rows carry ids, enums and
counters only (`assertAuditMetadataClean`). The alert is **produced** correctly once per account per hour except for the two issues
in SEC-M3B-01/02.

### 4.2 Ownership-transfer machinery

Verified: seller lock plus re-checks on every transition; initiator must be OWNER at execution; target 2FA and eligibility
re-checked at execution; at least one OWNER always remains (`planOwnershipChange`); 72 h floor also in the DB constraint; a staff
member who belongs to the seller cannot cancel it; at most 3 changes per seller per 7 days; accept needs a 2FA-verified session
and a fresh step-up; the in-app cancel returns 404 for non-parties. See SEC-M3B-04 for the cancel-token notes.

### 4.3 Business-email claim: MX and egress

Verified: the web app does **not** resolve DNS for this method (no resolver is injected, `claims.ts:47`); the MX lookup runs only
in the isolated egress group (`checks.ts:35-48`, `egress-main.ts`), which returns at most 20 records and maps NXDOMAIN/NODATA to
"no MX" and any other resolver failure to `DNS_ERROR` (back-off, expires at the challenge deadline). The core side re-runs
`assertHasMx` on the observed records at runtime (`checks.ts:132-138`) and rejects with `no_mx`, treating the RFC 7505 null MX
(`0 .`) as no MX (`domain-policy.ts:147-157`). A passing result moves the claim forward with a conditional update that makes the
token mail request exactly-once (`:139-146`). The domain must be the registrable domain (no subdomain mailboxes) and passes the
free-mail and shared-host deny-lists; per-user and per-domain mail caps are enforced. The egress process holds no DB, S3 or SMTP
variables (start-up assertion in `main.ts`, but see SEC-M3B-05) and `infra/egress/egress-policy.sh` limits its network. The fetcher
path remains the one reviewed in M3 (F-01 closed by the group split). Residual (Info): an MX that points at an internal name is
harmless to the platform because mail leaves through the configured relay, not a direct MX delivery.

### 4.4 Dependency and secret checks

`pnpm audit --prod`: no known vulnerabilities. Secret-pattern grep (AWS access keys, private-key headers, GitHub, OpenAI-style and
Slack tokens) over tracked files: no hits. `.env` files were not read.

## 5. Fix tasks to file

| Priority | Finding | Owner | Blocks |
|---|---|---|---|
| 1 | SEC-M3B-01 alert consumer and templates, with tests | Backend | Onboarding real users with 2FA |
| 2 | SEC-M4-01 `IP_HASH_KEY` boot assertion, env docs | Backend + DevOps | Onboarding real users |
| 3 | SEC-M4-10 / SEC-M4-07 gate the proof flow behind a flag until M5-02 (OCR, rasteriser, AV scan, pixel cap) | Backend | Enabling Verified Buyer proofs |
| 4 | SEC-M4-03, SEC-M4-04 staff-side authz fixes | Backend | Next sprint |
| 5 | SEC-M4-02, SEC-M3B-02, SEC-M3B-04 race and token fixes | Backend | Next sprint |
| 6 | SEC-M3B-05, SEC-M4-05, SEC-M4-06, SEC-M4-08, SEC-M4-09, SEC-M3B-03 | Backend / DevOps | Schedule |

## 6. QA gate hand-off (#71)

- **P0 defects to check: none.** There is no open `SEC-M4-xx` P0.
- Re-test list for QA when the P1/P2 fixes land: alert mails per `kind` (SEC-M3B-01), boot failure without `IP_HASH_KEY` in
  production mode (SEC-M4-01), 20 parallel vote switches leave counters equal to the vote rows (SEC-M4-02), admin without a
  verified 2FA session gets 403 on `/api/reviews/:id/revisions` (SEC-M4-03), seller-member/author admin gets 403 on
  `rejectReport` (SEC-M4-04).

## 7. Limits

Static review only. Not exercised: real S3/R2 behaviour (presigned PUT length enforcement, lifecycle rules), real SMTP and Redis
failure modes, multi-instance deployment effects on the in-process limiter fallback, the production wiring of the proof redactor
and extractor (`getProofDeps`), and any code not present in the tree (OCR adapter, PDF rasteriser).

## 8. Close-out (task #75)

Fixed: SEC-M3B-01 (worker consumer `sendSecurityAlertEmail`, template `security_alert`), SEC-M4-01 (no default key, `assertIpHashKey` at web and worker boot, `IP_HASH_KEY` in `.env.example`), SEC-M4-02, SEC-M4-03, SEC-M4-04, SEC-M3B-02 (`>= 3` trigger, row-locked count-then-insert). Still deferred: SEC-M3B-03, -04, -05, SEC-M4-05 to -10 (not in scope of #75).
