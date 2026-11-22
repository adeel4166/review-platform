# M5 + M6 + M7 security review (task #81, SEC-M5-M7)

| | |
|---|---|
| **Owner** | Security Engineer (QA_SECURITY) |
| **Branch** | `task/81` |
| **Scope** | M5 media pipeline and proof hygiene (tasks #72, #75), M6 moderation, staff, four-eyes, break-glass, appeals (#78, #80), M7 trust, votes, burst routing, notifications, comparison, social (#79, #80) |
| **Against** | [threat-model.md](./threat-model.md), [m3b-m4-security-review.md](./m3b-m4-security-review.md), [media-pipeline-runtime.md](./media-pipeline-runtime.md), ADR-0025 to ADR-0031, `docs/architecture/m6-m8-spec.md` |
| **Method** | Static review of the code cited per finding; no exploitation, no runtime stack (MySQL, Redis, MinIO, ClamAV, a real AI provider are not available in this sandbox). `pnpm audit --prod`: **No known vulnerabilities found**. Secret-pattern grep (AWS, PEM, `sk-`, `ghp_`, Slack, Google, JWT shapes, quoted `password/secret/token/api_key` assignments) over all tracked files: **no hits** except two obvious e2e test fixtures (`apps/web/e2e/helpers.ts:9`, `apps/web/e2e/auth.spec.ts:19`); no tracked `.env` file. No secret value is quoted here. |

## 1. Decision

**Result: FAIL (2 launch-blocking P0 findings).** Do not onboard real users or enable staff roles in production until both P0 items are fixed and re-tested.

| Level | Meaning |
|---|---|
| P0 | Exploitable now, or a launch-gating control is absent or bypassable with serious impact. Blocks launch. |
| P1 | A required control is missing, weak or not wired. Must be fixed before real-user onboarding; no direct exploit shown. |
| P2 | Hardening or bounded abuse. Schedule. |

The pattern behind most findings: the M6/M7 *libraries* (state machine, AI assess pipeline, burst routing, trust recompute, vote
freeze, notification dispatcher) are well designed and tested, but several are **not called by any production code path**
(grep over `apps/worker/src` and `apps/web/src`, excluding tests), so the live system still runs the M3-era behaviour.
Unit-test green does not mean the control is active.

## 2. Findings table

| ID | Sev | Title | Where (file:line) |
|---|---|---|---|
| SEC-M6-01 | **P0** | Role grant bypasses four-eyes: one SUPER_ADMIN can mint ADMIN/SUPER_ADMIN directly; `requestRoleGrant` has no caller | `apps/web/src/app/api/admin/staff/[id]/roles/route.ts:15`, `apps/web/src/server/staff-roles.ts:33-52`, `apps/web/src/server/approvals.ts:45-64` |
| SEC-M6-02 | **P0** | Live moderation uses the legacy path with the `mock` provider by default: anything without a blocklist word is auto-APPROVED; M6 `assess` and the prompt-injection hardening are not wired | `packages/core/src/moderation-provider.ts:61,55`, `apps/worker/src/processors.ts:19,65`, `apps/worker/src/moderation.ts:115-116` |
| SEC-M6-03 | P1 | Break-glass reads a non-existent model (`proofFile`), falls back to a hard-coded "exists" record, never binds `fileId` to `proofId`, and builds the storage key from unconstrained strings | `apps/web/src/server/break-glass.ts:16,47`, `apps/web/src/server/validation.ts:3` |
| SEC-M7-01 | P1 | Vote freeze, burst routing/exclusion, trust recompute/decay and the notification dispatcher have no production caller | `packages/core/src/trust/votes.ts:35`, `apps/worker/src/trust/routing.ts:17,42`, `apps/worker/src/trust/recompute.ts:14,34`, `packages/core/src/notifications/dispatch.ts:17` |
| SEC-M6-04 | P1 | `two_factor_reset` security alert has an unknown kind and is silently SKIPPED: the victim of an admin 2FA reset gets no mail (partial regression of SEC-M3B-01 intent) | `apps/web/src/server/approvals.ts:108`, `apps/worker/src/email.ts:110-124` |
| SEC-M6-05 | P1 | 2FA reset (four-eyes) has no target restriction: two ADMINs can strip the 2FA of a SUPER_ADMIN | `apps/web/src/server/approvals.ts:65-68,104-109`, `packages/core/src/approvals.ts:18` |
| SEC-M5-01 | P1 | ffmpeg/ffprobe run unsandboxed (no bwrap/prlimit/seccomp); ffprobe has no `-protocol_whitelist` or forced demuxer | `apps/worker/src/media/video.ts:16,31,65`, `docs/security/media-pipeline-runtime.md` ("Deviations") |
| SEC-M6-06 | P2 | Approval stale-check is a tautology for every kind except CONFIG; ROLE_GRANT executes without re-checking the target (2FA, ACTIVE) | `apps/web/src/server/approvals.ts:86-89,101-103` |
| SEC-M6-07 | P2 | Appeal filing route never passes `trustBand`, so the "NEW reporter cannot appeal" rule (AP-3) is dead; limiter closure ignores its max/window arguments | `apps/web/src/app/api/appeals/route.ts:19,17`, `apps/web/src/server/appeals.ts:23` |
| SEC-M6-08 | P2 | Security alerts (`break_glass_cap`, daily alert) only go to `console.error`; empty `sessionId` is accepted and matches itself | `apps/web/src/server/m6-routes.ts:14,11`, `apps/web/src/server/break-glass.ts:24,33` |
| SEC-M6-09 | P2 | `MODERATOR` / `SENIOR_MODERATOR` roles collapse to `user`; they pass no staff gate, and approver roles that name them are unreachable | `apps/web/src/server/auth.ts:19-22`, `apps/web/src/server/m6-routes.ts:7-12`, `packages/core/src/approvals.ts:19-20` |
| SEC-M6-10 | P2 | AI prompt injection: the defence is structural (scores-only strict schema), but injection can still push scores under `clean` and auto-publish; the regex hint is trivially bypassed | `packages/core/src/ai/prompt.ts:17`, `packages/core/src/moderation/classify.ts:81-82` |
| SEC-M7-02 | P2 | Notification abuse: sock-puppet follows trigger one email each for non-mandatory `NEW_FOLLOWER` (grouping key includes the actor); no per-recipient email cap | `packages/core/src/notifications/dispatch.ts:12-13,24`, `packages/core/src/social.ts:3` |
| SEC-M7-03 | P2 | Burst-routing evasion: only a 60-minute window; slow drip stays under 10/h (5/h low-trust); near-duplicate index is in-process memory and MinHash threshold 0.5 is evaded by paraphrase | `packages/core/src/trust/burst.ts:2,11-13`, `packages/core/src/trust/minhash.ts:48-60`, `apps/worker/src/trust/routing.ts:27-31` |
| SEC-M7-04 | P2 | Vote/trust gaming surface: vote weight is read from `user.trustBand` at write time and bands only move via the unwired recompute; `perIpDay: 3` uses an `ipHash` that is nulled at 90 days | `apps/web/src/server/votes.ts:41,61`, `packages/core/src/trust/votes.ts:31` |
| SEC-M5-02 | P2 | SEC-M4-07 residuals still open: proof originals stored without AV scan; redactor decodes with sharp default pixel limit and allocates a canvas of the decoded size | `apps/worker/src/proofs.ts:36,71`, `apps/web/src/server/proofs.ts:81` |
| SEC-M5-03 | P2 | Quarantined infected files are kept in `rp-private/quarantine/` with no retention or purge | `apps/worker/src/media.ts:110` |
| SEC-M6-11 | Info | Verified correct: see section 4 | n/a |

## 3. Findings

### P0

#### SEC-M6-01 (P0) Role grant bypasses four-eyes

- **Evidence.** The only route that grants staff roles, `POST /api/admin/staff/[id]/roles`, calls `grantStaffRole` directly
  (`roles/route.ts:15`). `grantStaffRole` (`staff-roles.ts:33-52`) upserts the `UserRole` row for **any** role, including `ADMIN` and
  `SUPER_ADMIN`, after one SUPER_ADMIN step-up. The four-eyes implementation (`roleGrantNeedsFourEyes`, `requestRoleGrant`,
  `approveRequest` ROLE_GRANT branch, `approvals.ts:45-64,101-103`; ADR-0026, AZ-015) has no caller from any route: grep for
  `requestRoleGrant` finds only the definition and `m6.int.test.ts`. The existing `staff-roles.test.ts` asserts the old single-actor behaviour.
- **Impact.** A single compromised or malicious SUPER_ADMIN (session theft plus a step-up) creates further SUPER_ADMINs and ADMINs, and
  with ADMIN gets proof viewing, enforcement, config activation requests. The spec's launch-gating control (second SUPER_ADMIN for every
  non-MODERATOR grant) does not exist at runtime.
- **Fix.**
  1. Change the route so `POST` calls `requestRoleGrant(m6db, staffOf(actor), id, body.role, body.reason, clock)` and returns its status
     (`202 {approvalRequestId}` for ADMIN, SENIOR_MODERATOR, SUPER_ADMIN; `201` only for MODERATOR).
  2. Make `grantStaffRole` throw `403` for every role except `MODERATOR` (or delete it and keep `revokeStaffRole`), so no code path can
     insert a non-MODERATOR `user_roles` row except `approveRequest`.
  3. In `approveRequest` ROLE_GRANT branch, re-check inside the transaction that the target is `ACTIVE`, email-verified and has confirmed
     2FA, and that `p.role` is in the allowed enum (also see SEC-M6-06).
  4. Tests: SUPER_ADMIN POST `role=SUPER_ADMIN` returns 202 and `user_roles` is unchanged; the same actor approving returns 403
     `approval_self`; a second SUPER_ADMIN with fresh step-up approving creates the row exactly once; ADMIN approving returns 403. Update
     `staff-roles.test.ts`. Add a static test that `userRole.upsert` appears only in `approvals.ts` and the MODERATOR path.

#### SEC-M6-02 (P0) Production moderation is the mock blocklist; M6 engine and AI hardening are not wired

- **Evidence.** `createModerationProvider` defaults to `"mock"` when `MODERATION_PROVIDER` is unset (`moderation-provider.ts:61`), and
  `processors.ts:19` builds the provider that way. The moderation queue handler calls the legacy `processModeration`
  (`processors.ts:65`), which uses `provider.assess` and `decideVerdict` (`moderation.ts:115-116`). The mock returns
  `score 0.02, confidence 0.9` for any text without two blocklist words (`moderation-provider.ts:55`), which `decideVerdict` maps to
  APPROVED. So with default configuration every review that avoids a handful of literal strings (`scam`, `fraud`, `http://`, ...) is
  auto-published. The M6 pipeline (`runAssess`, `classify`, strict scores-only schema, fixed system prompt, circuit breaker, trust-band
  and external-link force-UNSURE) is only reachable from `rescan-failed.ts:19`; no job produces the initial assessment through it.
- **Impact.** AI-first moderation is effectively off: spam, scam links written as `hxxp`, harassment, or any evasion text is published
  without human review. The SEC-008 prompt-injection controls cannot protect anything because no LLM is called.
- **Fix.**
  1. `createModerationProvider` must throw when `NODE_ENV=production` and the name is `mock` (or unset); add the same assertion at worker
     boot next to `assertIpHashKey()` in `core-main.ts:15`. Keep the mock for `NODE_ENV=test|development` only.
  2. Route the `moderation` queue's initial assessment through `runAssess` with a real `ProviderCall` built from `SYSTEM_PROMPT`,
     `buildUserMessage`, `parseProviderResponse`, the `Breaker` and `DailyCap`, and the DB-backed `AssessPort`. Remove `decideVerdict`
     from the publish path (it may stay as a fallback that can only return NEEDS_HUMAN).
  3. Fail closed: any provider error, schema failure or timeout must leave the content in HELD/PENDING, never APPROVED.
  4. Tests: worker boot refuses `mock` in production mode; an integration test where the provider returns the mock "clean" shape for a
     body containing an obfuscated link ends in lane HOLD; a response with an extra `verdict` key is a schema failure and UNSURE.

### P1

#### SEC-M6-03 (P1) Break-glass: wrong model, fallback record, unbound file, free-form key parts

- **Evidence.** `requestOriginalAccess` and `serveOriginal` read `tx.proofFile?.findUnique(...)` (`break-glass.ts:16,47`). The Prisma
  model is `PurchaseProofFile` (`schema.prisma:1270`), so `tx.proofFile` is `undefined` in production and the code takes the fallback
  `{ originalKey: "x", originalPurgedAt: null }` (request) and ``proof/${proofId}/orig/${fileId}`` (serve). Consequences: the
  "original purged" check (`decideBreakGlass`, `410 original_purged`) can never fire; `fileId` is never checked against `proofId` or
  `isRedacted=false`; the worker writes originals at `proof/<fileId>/orig` (`apps/worker/src/proofs.ts:43`) so the fallback key does not
  match and the feature fails at runtime (a functional break, hidden because `m6.int.test.ts` injects a fake `proofFile` table).
  `idParam` is any string of 1 to 64 characters (`validation.ts:3`), so `proofId`/`fileId` can contain `/` and `..` and are
  concatenated into an object key.
- **Impact.** Once the key scheme is "fixed" by aligning the fallback, staff could read any private-bucket object by crafting ids, or a
  file of a different submitter than the audited proof. The audit row would name the wrong proof.
- **Fix.** Use `tx.purchaseProofFile.findFirst({ where: { id: fileId, proofId, isRedacted: false, purgedAt: null } })`; 404 when absent
  (no fallback object, no optional chaining on the model). Take the key only from the stored `storageKey`. Validate ids with the cuid
  pattern in this route. Make the `BreakGlassTx` type require the model so a missing model is a compile error. Add a test that fails
  when the delegate is missing and one where `fileId` belongs to another proof.

#### SEC-M7-01 (P1) M7 backend controls are not wired

- **Evidence.** No non-test caller exists for `detectVoteAnomaly`, `routeReview`, `applyBurst`, `recomputeSubject`, `nightlyDecay` or
  `dispatch`. `votes.ts:41` reads `votesFrozenAt` but nothing sets it. `core-main.ts` registers no trust or burst jobs. The only web
  notification writer is `restoreContent` (`m6-ui.ts:90`).
- **Impact.** Product-burst holds, near-duplicate holds, vote-ring freezes, trust decay and most notifications (including the mandatory
  statements of reasons) do not run. Users' `trustBand` stays at the schema default, so every vote has weight 0 (voting is a no-op, see
  SEC-M7-04) and every author is treated as NEW.
- **Fix.** Register jobs: `trust.recompute` (on signal insert and nightly 02:00), `trust.product-burst`, vote-freeze check after each
  counted vote, and call `routeReview` as step 1 of `moderation.assess` for REVIEW targets. Route outbox events to `dispatch` and give
  `approval.requested`/`approval.executed` a consumer (today they fall through to SKIPPED, `outbox.ts:25-26`). Add a repo-level test that
  asserts each exported M7 entry point is referenced from a processor or route (a "no dead control" static test).

#### SEC-M6-04 (P1) `two_factor_reset` alert is dropped

- **Evidence.** `approveRequest` emits `auth.security_alert` with `kind: "two_factor_reset"` (`approvals.ts:108`). The worker consumer
  looks the kind up in `SECURITY_ALERT_COPY`, which has six upper-case kinds and no such key (`email.ts:110-124`), and returns `SKIPPED`.
- **Impact.** An account whose 2FA was removed by staff (legitimately or by a rogue pair of admins) is never told, which is the exact
  detection gap SEC-M3B-01 was meant to close.
- **Fix.** Add `TWO_FACTOR_RESET` copy and emit the upper-case kind; make the consumer log at error level (and alert) on an unknown kind
  instead of returning `SKIPPED`. Extend `m4-close.test.ts` to iterate every `kind` emitted anywhere in `apps/web/src`.

#### SEC-M6-05 (P1) 2FA reset can target staff, approved by ADMIN

- **Evidence.** `requestTwoFactorReset` accepts any `targetId`; approval needs only ADMIN/SUPER_ADMIN other than the requester
  (`approvals.ts:65-68`, `core/approvals.ts:18`). Execution deletes TOTP and recovery codes and revokes sessions (`approvals.ts:104-107`).
- **Impact.** Two colluding or compromised ADMINs can remove the second factor of any SUPER_ADMIN; with a phished password that is a
  full takeover of the highest role, bypassing SEC-M6-01's intended protection.
- **Fix.** If the target holds any staff role, require a SUPER_ADMIN approver and a SUPER_ADMIN requester; forbid targeting a SUPER_ADMIN
  unless two other SUPER_ADMINs are involved; keep staff roles suspended (the 2FA gate already denies) until re-enrolment; always send
  the alert from SEC-M6-04.

#### SEC-M5-01 (P1) Unsandboxed media parsers

- **Evidence.** `run()` spawns `ffmpeg`/`ffprobe` directly with a kill timer (`video.ts:16`). `ffprobe` has no `-protocol_whitelist`
  (`video.ts:31`; only ffmpeg has it, `:65`), no forced input format, no memory/CPU/process limits, stdout is buffered without a cap. The
  runtime doc lists the bwrap/prlimit sandbox as a deviation to be added "before production".
- **Impact.** A crafted MP4/MOV that passes the `ftyp` sniff can exploit a demuxer/decoder bug, or abuse protocol-reference features in
  ffprobe, inside the core worker, which holds DB and Redis credentials and the private bucket.
- **Fix.** Run both binaries under `bwrap --unshare-all --die-with-parent --ro-bind` (no network, tmpfs working dir) plus
  `prlimit --as=1.5G --cpu=120 --nproc=64 --fsize=200M`, or move video to a separate worker group with no DB/Redis credentials and a
  read-only root. Add `-protocol_whitelist file -f mov,mp4` to ffprobe and to ffmpeg `-i`, cap stdout to 1 MiB, and add the
  `-max_alloc` and `-threads 2` options. Gate video uploads behind a flag until done. Images already use sharp with `limitInputPixels`
  (`media.ts:59`) and are lower risk.

### P2 (summaries, each with a concrete fix)

- **SEC-M6-06.** `approveRequest` sets `currentHash = a.payloadHash` for every kind but CONFIG (`approvals.ts:86-89`), so `approval_stale`
  never fires, and the ROLE_GRANT branch (`:101-103`) does not re-check the target. Fix: recompute a hash from live state (target status,
  `confirmedAt`, existing roles) per kind and compare; reject 409 on drift.
- **SEC-M6-07.** `fileAppeal(deps, { id: user.id }, body)` (`appeals/route.ts:19`) omits `trustBand`, so `appeals.ts:23` never denies a
  NEW reporter; the route limiter closure (`:17`) hard-codes `limitAppeal` (3/day) and ignores its arguments, which is acceptable but
  misleading. Fix: load `trustBand` from the DB in the route; add a test for NEW reporter 403. Appeal abuse otherwise holds: appellant is
  session-derived, one appeal per case per user, window and version checks, 404 for foreign cases, COI check at claim, four-eyes for
  BAN/SELLER_SUSPENSION overturn, lease and immutable note.
- **SEC-M6-08.** `alert()` writes JSON to stderr (`m6-routes.ts:14`) and relies on log shipping. Fix: enqueue to the real security
  channel and page on `break_glass_cap`. `staffOf` maps a missing `sid` to `""` (`m6-routes.ts:11`); reject staff sessions without a `sid`.
- **SEC-M6-09.** `roleFrom` (`auth.ts:19-22`) returns only `user|admin|super_admin`, so MODERATOR and SENIOR_MODERATOR grants have no
  effect today and `APPROVER_ROLES` entries for SENIOR_MODERATOR can never be satisfied. Safe (fails closed) but a coherence gap; when
  these roles are made live, add them to `staffOf` and re-test every `requireAdmin` route for least privilege (moderators must not reach
  proofs, break-glass, config, role routes).
- **SEC-M6-10.** `assess` builds a fixed system prompt and sends content only inside a JSON string; the response must be a strict
  scores object (`provider.ts:5-13`), so an injected "verdict" is a schema failure. Residual risk: an injection that lowers category
  scores below `clean` yields CLEAN. Existing mitigations (hard floors, rule hits before the provider, link and trust-band force-UNSURE,
  rule hit `instructionLike`) cover the obvious cases. Fix: treat `instructionLike` as force-UNSURE (not only a hint) for NEW and LOW
  authors, sample 2% of AI-CLEAN content into the post-review human lane, log provider `rationale` only as escaped text, and keep the
  pinned prompt hash test (`prompt.test.ts`). The `rating` field is a validated number; `title`/`body` are length-capped upstream.
- **SEC-M7-02.** `groupKeyOf` for `NEW_FOLLOWER` includes `entityId` (the follower), so N sock-puppets yield N emails to one victim, 200
  follows/actor/day. Fix: per-recipient email cap (for example 5/hour for non-mandatory types, then digest), group `NEW_FOLLOWER` by
  recipient and day. Mandatory types cannot be disabled (verified: `assertPreferenceAllowed`, `dispatch`), which is intended, but emit
  them only from server-side state changes. In-app list is recipient-scoped and the link target is derived from `entityType`
  (`NotificationCenter.tsx:12`), so no client-controlled URL is rendered.
- **SEC-M7-03.** Burst thresholds are per rolling hour. Fix: add a 24 h threshold (for example 40 per product, 15 low-trust), a
  per-author-per-seller cap, lower the near-duplicate threshold for NEW/LOW authors, normalise homoglyphs before shingling, and back the
  index with `review_lsh_buckets` (the in-memory `NearDuplicateIndex` is per-process and empties on restart).
- **SEC-M7-04.** Vote gaming: authors cannot self-vote, seller members are blocked, restricted voters are blocked, NEW voters carry
  weight 0, per-hour and per-IP limiters exist, counters change by relative increments in one transaction (SEC-M4-02 fix verified at
  `votes.ts:64-81`). Residuals: the `perIpDay` rule depends on `ipHash` that the retention job nulls at 90 days (fine for the 24 h
  window) and requires SEC-M7-01 to run. Trust gaming via `REPORT_UPHELD` farming is capped (+5) and signals are idempotent on
  `(type, sourceType, sourceId, subjectKey)` (`prisma-ports.ts:7-12`); `HELPFUL_VOTE_RECEIVED` is capped (+15) and keyed per `VoteDay`.
- **SEC-M5-02.** Fix per SEC-M4-07: run ClamAV on proof originals before they are stored (`proofs.ts:71`), pass
  `limitInputPixels: MEDIA_MAX_PIXELS` to the redactor's `sharp` calls (`proofs.ts:36`), cap `slot` creation per proof per hour
  (`proofs.ts:81` counts only non-terminal files), and keep PDFs rejected until a sandboxed rasteriser exists (currently fail-closed:
  `pdf_rasteriser_unavailable`).
- **SEC-M5-03.** Add a retention sweep for `quarantine/*` (for example 30 days) and an alert on a quarantine count threshold.

## 4. Verified correct (no action)

- **SEC-M3B-01 is CLOSED** for the six original kinds: producer `two-factor.ts:39-40`, outbox mapping `outbox.ts:63`, consumer
  `processors.ts:101` to `sendSecurityAlertEmail` (`email.ts:110-129`, fixed copy, no code/IP in mail, ACTIVE accounts only,
  idempotency key = job id), tests `apps/worker/src/m4-close.test.ts:19-50`. Residual gap for the new `two_factor_reset` kind: SEC-M6-04.
- **SEC-M4-01 is CLOSED**: no default key (`reports.ts:17-22`, min 32 chars), boot assertion in web (`instrumentation.ts:5`, nodejs
  runtime) and worker (`core-main.ts:15`), documented in `.env.example:81`, tests `packages/core/src/m4.test.ts:125-153` (including that
  the error never prints the value). `assertIpHashKey` is skipped only under `NODE_ENV=test`.
- **Staff authz and 2FA gate.** Every route under `apps/web/src/app/api/admin` calls `requireAdmin` or `requireSuperAdmin` (grep for route
  files without either found none); both go through `requireTwoFactor` (enrolled AND verified this session, `session.ts:40-43`); the
  pending-2FA middleware (`middleware.ts:24-43`) is a UX layer and `requireUser` also rejects pending sessions (`session.ts:17`). Step-up
  (10 min) is enforced for role changes, config activation, approvals, 2FA reset requests and break-glass requests.
- **Four-eyes primitives.** `assertCanApprove` enforces PENDING, not expired, requester != approver, approver role, stale hash
  (`core/approvals.ts:33-39`); double approval is a conditional `updateMany` (409); one open request per target (`openKey`); 24 h TTL.
  The defect is only that role grants skip it (SEC-M6-01).
- **Break-glass rules.** Reason 20 to 500 chars, no self-access to own submission, step-up, daily cap 20 with alert at 10, 7-day repeat
  needs approval, single-use conditional `updateMany(usedAt: null)`, session bound, 60 s TTL, no-store/nosniff/CSP-sandbox headers,
  server-side read with the key never presigned (`core/break-glass.ts`, `break-glass.ts:38-53`). Defects are in persistence (SEC-M6-03).
- **Media pipeline.** Order is size, content-type, polyglot, banned hash, ClamAV (fail closed after 72 h stale), re-encode from pixels,
  metadata verify, READY in private; public copy only via `media.promote` after approval; infected files are quarantined and the threat
  name stays in the processing log (`media.ts:75-113`, `media-pipeline-runtime.md`). Proofs: redactor fails closed to a solid black
  derivative, OCR text and raw order numbers are never persisted, files are in the private bucket, no public key.
- **Public surface.** Profile DTO is a whitelist (`social.ts:16-21`: no email, numeric score, status, ipHash); suspended/blocked users
  return the same 404; compare is capped at 2 to 4 ids, rate limited, built from cached columns only (`compare.ts`, `ratelimit.ts:119-121`).
- **Dependencies and secrets.** `pnpm audit --prod`: no known vulnerabilities. Secret grep: no hits (section header).

## 5. Fix order

| # | Item | Owner | Gate |
|---|---|---|---|
| 1 | SEC-M6-01 role grants through four-eyes only | Backend | Any production staff roles; blocks launch |
| 2 | SEC-M6-02 no mock in production, wire `assess`, fail closed | Backend | Any real review traffic; blocks launch |
| 3 | SEC-M6-03 break-glass model/binding/key fix | Backend | Enabling Verified Buyer proofs |
| 4 | SEC-M7-01 wire trust, burst, vote-freeze, dispatch jobs, with a "no dead control" test | Backend | Real-user onboarding |
| 5 | SEC-M6-04, SEC-M6-05 2FA reset alert and target rules | Backend | Real-user onboarding |
| 6 | SEC-M5-01 sandbox ffmpeg/ffprobe or disable video | DevOps + Backend | Enabling video uploads |
| 7 | P2 items | Backend / DevOps | Schedule |

Re-test list for QA after fixes: ADMIN/SUPER_ADMIN grant returns 202 and needs a second SUPER_ADMIN (SEC-M6-01); production boot fails with
`MODERATION_PROVIDER` unset or `mock` and a clean-looking obfuscated-link review lands in HOLD (SEC-M6-02); break-glass for a `fileId`
of another proof returns 404 and for a purged original returns 410 (SEC-M6-03); a 2FA reset sends a mail (SEC-M6-04); a staff 2FA reset
needs SUPER_ADMIN (SEC-M6-05); a burst of 11 reviews/hour on one product produces HOLD cases and a `product.burst_opened` event (SEC-M7-01).

Not covered: runtime behaviour of S3/R2 policies, ClamAV and CDN purge, real SMTP, a real AI provider's behaviour under injection, the
future PDF rasteriser and OCR, messaging (Phase 2).
