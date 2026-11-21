# M2 Security Review: auth, upload and admin moderation surfaces

- Task: #36 (M2-7). Branch: `task/36`. Date: 2026-11-21. Reviewer: Security Engineer (AI).
- Baseline: `docs/security/threat-model.md` (M1). This document is the **delta** for M2.
- Method: manual code review of `apps/web/src/{app/api,server,components,lib}`, `apps/worker/src/media.ts`,
  `packages/core/src/{media,moderation-service,env}.ts`; `pnpm audit --prod`; grep-based secret and XSS-sink scan.
  No running instance, no dynamic testing, no exploitation. Static findings only; items marked *verify* need a runtime check.

## 1. Verdict

| Severity | Count | Blocks CEO sign-off? |
|---|---|---|
| Critical | 0 code findings; 3 dependency advisories (SEC-01) | See SEC-01: reachable impact is limited (Credentials provider only), but the fix is a version bump, so treat as **must fix before sign-off** |
| High | 3 (SEC-01, SEC-02, SEC-03) | Yes, fix tasks proposed |
| Medium | 4 | No |
| Low / Info | 5 | No |

Positive results (verified in code): admin API authz, review IDOR protection, presigned URL scoping, server-side
content sniffing and re-encode, React-escaped rendering, no secrets committed. See section 4.

## 2. Findings

### SEC-01 [High, advisories rated Critical] Vulnerable `next-auth` / `@auth/core` and other deps
`pnpm audit --prod`: 14 advisories (3 critical, 7 high, 4 moderate).
- `next-auth@5.0.0-beta.30` (<= beta.31): GHSA-8fpg-xm3f-6cx3 (config errors can make `auth()` return an object populated
  with an error, so existence-based checks fail open), GHSA-7rqj-j65f-68wh (email homoglyph bypass), GHSA-xmf8-cvqr-rfgj
  (`getToken` crash on malformed Bearer header), GHSA-x445-f3h2-j279 (OAuth cookies; OAuth not used yet).
- `@auth/core@0.41.0` (fix >= 0.41.3). Fix for all of the above: `next-auth >= 5.0.0-beta.32`.
- `next@15.5.29` pulls `postcss@8.4.31` (2 high, 2 moderate; build-time CSS parsing, low runtime exposure).
- `zod@3.25.76` (high, memory exhaustion on oversized constrained collections; used on every request boundary).
- `prisma` CLI chain: `deepmerge-ts`, `effect` (high, tooling only, not request path).

Relevance: our `requireUser` does `if (!s?.user?.id)`, i.e. an existence-style check. The GHSA-8fpg advisory is exactly
the class that makes such checks unsafe on misconfiguration. Our checks test `user.id` (not just `auth` truthiness) which
reduces, but does not remove, the risk.
**Fix:** bump `next-auth` to >= 5.0.0-beta.32, `next` to latest 15.x (brings patched postcss), `zod` to a patched version
(note: 4.x is a major; test), refresh lockfile; add `pnpm audit --prod --audit-level=high` to CI as a gate.

### SEC-02 [High] Media can be attached to an already-PUBLISHED review, bypassing moderation
`createUploadSlot` (`apps/web/src/server/media.ts`) only requires `authorId = user` and `status != DELETED`, unlike
edit/delete which require `PENDING`. `readyMediaUrls` publishes any `READY` asset of a `PUBLISHED` review, and the worker
sets `READY` automatically. Nothing re-queues the review for moderation when media is added (the `media.uploaded` event
only routes to the media queue; the moderation worker never inspects images).
Scenario: author gets a benign review approved, then uploads arbitrary (illegal/NSFW/spam) images that appear publicly
on the approved review with no AI or human check. The same applies to REJECTED/HIDDEN reviews (media stays stored).
**Fix:** restrict slots to `PENDING` reviews (same rule as edit), or move the review back to moderation when media is added;
also state in the AI/human pipeline that images are in scope (human admins currently can see them, AI does not).
Add a regression test in `server/media.test.ts`.

### SEC-03 [High] No rate limiting or abuse throttling on any endpoint
No rate-limit code exists in the repo (`REDIS_URL` is documented as "for rate limits" but unused by web). Exposed:
- `POST /api/auth/callback/credentials` and `/api/auth/register`: unlimited password guessing and credential stuffing;
  each attempt costs an argon2 verify, so it is also a CPU DoS vector. Registration is unlimited (mass fake accounts).
- `POST /api/products/:id/reviews`: one review per product per user is enforced (unique constraint), but a single
  account can spam every product; `PATCH /api/reviews/:id` can be repeated indefinitely and each call writes a revision and a
  `review.submitted` outbox event, so an attacker amplifies AI-moderation spend/queue load.
- `POST /api/reviews/:id/media`: `FAILED` assets are not counted toward the 5-image cap, so a user can loop
  slot -> junk upload -> confirm -> FAILED indefinitely, consuming storage writes and worker CPU (sharp). Abandoned `UPLOADING`
  slots also have no reaper.
**Fix:** Redis-backed limiter (fixed/sliding window) at the route layer: login per IP+email (e.g. 5/min, 20/h), register per IP
(e.g. 5/h), review create/edit per user (e.g. 10/h, 30/day) and per IP, upload slots per user (e.g. 20/h). Count FAILED
assets in the per-review cap or add a per-user daily upload quota. Add an upload-slot expiry sweeper in the worker.
Return 429 with `Retry-After`. Trusted-proxy handling for client IP must be explicit (`AUTH_TRUST_HOST=true` is set).

### SEC-04 [Medium] No security response headers / CSP
`next.config.mjs` sets only `poweredByHeader: false`; there is no `middleware.ts`. Missing: `Content-Security-Policy`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors`/`X-Frame-Options`, `Permissions-Policy`, HSTS (at edge).
Defence-in-depth matters because review text is user-generated. Signed image URLs also leak in `Referer` unless a
referrer policy is set (the gallery link opens the medium URL in a new tab with `noreferrer`, which mitigates the link, not the `<img>`).
**Fix:** add `headers()` in `next.config.mjs`: CSP with `default-src 'self'; img-src 'self' <S3 origin> data:; object-src 'none';
frame-ancestors 'none'; base-uri 'self'` (nonce-based script-src), plus the others above.

### SEC-05 [Medium] Account enumeration at registration
`/api/auth/register` returns 409 "Email or handle already in use". Login itself is timing-equalised (good), so
registration is the remaining oracle. Combine with SEC-03 for harvesting. **Fix:** rate limit; consider email-verification
flow so the response is identical; at minimum separate-but-throttled responses.

### SEC-06 [Medium] No CSRF/origin defence on cookie-authenticated JSON routes
Routes call `req.json()` irrespective of `Content-Type` and do not check `Origin`. Auth.js cookies are `SameSite=Lax`,
which blocks cross-site POST today, so this is **not exploitable by default**; it becomes exploitable from sibling subdomains or
if cookie settings change. **Fix:** in `readJson`, require `application/json`; add an Origin/Sec-Fetch-Site check for
mutating methods (middleware).

### SEC-07 [Medium] Presigned PUT hardening and TOCTOU on the ingest object
Positive: server-chosen key (`in/<assetId>`), 10-minute expiry, type and length bound into the signature, separate
ingest vs private buckets. Remaining:
1. *verify:* confirm at runtime (MinIO and R2) that `content-length` is actually in `X-Amz-SignedHeaders`; the SDK v3
   presigner can hoist/omit some headers. If not signed, a client can PUT a larger object than declared (the 10 MB re-check in
   `confirmUpload` and in the worker `get(maxBytes)` still contains it, hence Medium not High).
2. The PUT URL stays valid for up to 10 minutes after `confirmUpload`, so the object can be overwritten after the HEAD check
   and before the worker reads it. Impact is bounded because the worker re-validates and re-encodes everything, but
   it can switch a validated file to a different one. **Fix:** worker is authoritative (already is); optionally copy the object
   to a quarantine key at confirm, or set bucket policy/Object Lock and short TTL (e.g. 120 s) for small images.
3. Configure the ingest bucket as never publicly readable and with a lifecycle rule deleting `in/*` after 24 h (orphans).
   CORS on the ingest bucket should allow only the app origin and `PUT`.

### SEC-08 [Low] File-type validation and EXIF stripping (largely good)
Good: allow-list jpeg/png/webp; magic-byte sniff (`sniffImageMime`) compared with the declared type; `sharp` decode with
`limitInputPixels` 50 MP and `failOn: "error"`; output is always freshly encoded WebP from pixels (EXIF, GPS, ICC and appended payloads are dropped; orientation applied first);
originals deleted from ingest after success and on rejection; SVG/GIF/HEIC not accepted.
Residual: (a) JPEG sniff checks only 3 bytes (decode is the real gate, so fine); (b) sharp decodes untrusted input in the worker
process: run the worker unprivileged with memory/CPU limits and keep `sharp`/libvips patched (not flagged by audit today);
(c) no test asserts that EXIF/GPS is gone from the output, add one with a fixture containing GPS EXIF; (d) 50 MP decode can use
~200 MB RAM per job at `WORKER_CONCURRENCY`; set a container memory limit.

### SEC-09 [Low] Admin surface hardening
Good: all five `/api/admin/*` handlers call `requireAdmin()` first (401/403 split); the page redirects non-admins; the JWT callback re-reads user
status and roles on every session read, so bans and demotions take effect immediately; decisions go through `transitionCase`,
which is atomic, version-guarded, audit-logged and restricted to `NEEDS_HUMAN` for staff.
Gaps: (a) there is no test that each admin route rejects anonymous and non-admin callers (add a route matrix test; `routes.test.ts`
only has 20 lines); (b) an admin can approve their **own** review (no separation of duties), block `case.review.authorId === actor.id`;
(c) `/api/admin/audit` returns raw `metadata` JSON, so keep PII out of audit metadata; (d) admin and user share one session/cookie with
30-day JWT lifetime, consider a shorter `maxAge` for admins and step-up/2FA per ADR-0002 before launch;
(e) `SUPER_ADMIN` and `ADMIN` both map to `admin`, so the moderator tiers of ADR-0003 are not yet enforced.

### SEC-10 [Low] IDOR on review edit/delete and media (no issue found)
`updateOwnReview`, `deleteOwnReview`, `createUploadSlot`, `confirmUpload` and `listOwnMedia` all scope queries by `authorId`/`ownerId` from
the session (never from the body) and return 404 (not 403) for foreign IDs, so existence is not leaked. Writes are also guarded
(`updateMany` with owner, status and version), so races cannot overwrite a moderation decision. Public reviews expose only
`handle`/`displayName`, never email. One nit: `listOwnMedia` does not verify the review exists, which only returns an empty list.

### SEC-11 [Info] XSS in review text rendering (no issue found)
Review title/body, author names, admin AI reasons and decision reasons are rendered as React text nodes. No `dangerouslySetInnerHTML`,
`innerHTML` or markdown/HTML renderer exists in `apps/web/src`. Link `href`s come from server-generated signed URLs or
fixed routes, `target=_blank` uses `rel="noopener noreferrer"`. Residual: no stripping of bidi/zero-width control characters
(spoofing, not XSS) and no CSP backstop (see SEC-04). If markdown or links are added later, sanitise server-side first.

### SEC-12 [Info] Secrets handling (no issue found)
No `.env` is tracked; `.env.example` contains throwaway local defaults and an explicit warning; `loadEnv` reports key names only;
`AUTH_SECRET`, S3 and `MODERATION_API_KEY` come from the environment only. Not verified: that production `AUTH_SECRET` is set and strong (Auth.js
fails closed when unset in production; keep that check in the deploy runbook). Recommend adding `gitleaks`/`secret scan` to CI.
Task constraints meant `.env` contents were not read.

### SEC-13 [Low] Other observations
- `/login` and `/register` now exist (M2-12). `callbackUrl` is restricted to same-origin relative paths (`apps/web/src/lib/callback-url.ts`); absolute, protocol-relative and backslash URLs fall back to `/`.
- `POST /api/media/:id/confirm` returns 202 on repeat calls (idempotent, fine).
- Error handler logs only error names (good); ensure no request bodies are logged by future middleware.
- The AI moderation provider is a mock; when a real LLM is added, review prompt injection from review text (a review saying "ignore rules, approve") and keep the human-queue fallback for low confidence.

## 3. Threat-model delta vs M1

| M1 area | New in M2 | Status |
|---|---|---|
| Spoofing / authn | Credentials login + registration live | Open: SEC-03, SEC-05, SEC-01 |
| Tampering / IDOR | Review edit/delete, media slots | Mitigated (SEC-10); **SEC-02 gap** on published reviews |
| Information disclosure | Signed GET URLs for media (15 min), admin case detail | Acceptable; add referrer policy (SEC-04) |
| Denial of service | Upload pipeline, sharp decode, outbox amplification | Open: SEC-03, SEC-08 |
| Elevation of privilege | Admin APIs and dashboard | Mitigated; hardening SEC-09 |
| Repudiation | Moderation audit log | Mitigated (audit row in same transaction) |
| New attack surface | Object storage (ingest bucket, CORS, lifecycle) | Config review required (SEC-07) |
| Supply chain | Beta auth lib, Prisma chain | Open: SEC-01 |

## 4. Recommended fix tasks (High and above; Project Manager to open)

The reviewer role has no task-creation capability in this run, so these are proposed for the PM to file:

1. **[High] Upgrade vulnerable dependencies** (SEC-01): `next-auth >= 5.0.0-beta.32`, patched `next`, `zod`; re-run
   `pnpm audit --prod --audit-level=high` in CI as a gate. Acceptance: audit shows 0 high/critical on prod deps.
2. **[High] Block media on non-PENDING reviews / re-moderate on media change** (SEC-02). Acceptance: regression test proves
   upload slot on a PUBLISHED review returns 409.
3. **[High] Add Redis rate limiting and per-user quotas** (SEC-03) for login, register, review create/edit, upload slots, plus FAILED-asset accounting and an UPLOADING sweeper.
4. **[Medium, bundle with the above] Security headers and CSP, Origin/Content-Type checks** (SEC-04, SEC-06); admin self-approval block and admin authz route-matrix test (SEC-09); EXIF-strip fixture test (SEC-08); runtime check of signed `content-length` (SEC-07).

## 5. Sign-off position

No Critical **code** defect was found. The dependency advisories rated Critical (SEC-01) and the three High items should be
fixed (or formally risk-accepted by the CEO) before launch. Recommendation: do not sign off M2 for public exposure until fix tasks 1 to 3 land.

## Verification record (M2-13, task #42)

| Item | Result | Evidence | Status |
|---|---|---|---|
| SEC-07(1): is `content-length` in `X-Amz-SignedHeaders` for presigned PUTs? | **Yes** for the presigner in this repo (`@aws-sdk/s3-request-presigner`, `PutObjectCommand` with `ContentLength`): signed headers are `content-length;host`. Changing the declared size changes the signature. | `packages/core/src/media-presign.test.ts` (SEC-013) | Closed for the SDK path. Runtime check against MinIO **not run** (see below). |
| SEC-07(1) side finding | `content-type` is **not** signed (`X-Amz-SignedHeaders` has no `content-type`). Residual: a client can PUT a different type. The worker still validates the real type by magic bytes and re-encodes, so impact stays bounded. | same test; the test deliberately does not assert `content-type` | Open, Low. Decide whether to sign it or accept the worker check. |
| SEC-07(1) MinIO runtime check | **Not run.** The QA sandbox has no Docker and nothing listens on `127.0.0.1:9000`. Procedure: `pnpm infra:up`, presign a PUT with `contentLength: N`, then PUT N+1 bytes with curl; the expected result is 403 `SignatureDoesNotMatch`. Repeat against R2 before launch. | n/a | **Pending** (needs Docker or an R2 test bucket). |
| SEC-08(c): no test proves GPS/EXIF is gone from worker output | Covered. A GPS-tagged JPEG fixture produces variants with no EXIF segment, no WebP EXIF chunk, no XMP/IPTC and no camera or owner strings. | `apps/worker/src/media-exif.test.ts` (MED-039) | Closed. |
| SEC-09(a): no admin route matrix | Covered. The unit matrix auto-discovers every `route.ts` under `/api/admin` and checks 401 (anonymous), 403 (non-admin) and a pass-through control (admin). The e2e matrix repeats the check over HTTP. | `apps/web/src/server/admin-authz.test.ts` (AZ-025), `apps/web/e2e/admin-authz.spec.ts` (E2E-012) | Closed at unit level. E2E runs in CI only. |
