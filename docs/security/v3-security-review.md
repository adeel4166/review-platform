# v3 security review (V3-01..V3-08)

Task #110. Scope: AI review summaries, Cloudinary public tier, next/image + CSP, Cmd+K search, new dependencies. Method: code read of `packages/core/src/ai/summary.ts`, `apps/worker/src/summary/generate.ts`, `packages/core/src/cloudinary.ts`, `apps/web/next.config.mjs`, `apps/web/src/server/security-headers.ts`, `apps/web/src/app/api/products/route.ts`, `AiSummaryCard.tsx`, `CommandPalette.tsx`; `pnpm audit --prod`; licence inspection. No live exploitation. Secrets referenced by NAME only.

## Findings summary

| ID | Area | Severity | Status |
|---|---|---|---|
| SEC-V3-01 | `GET /api/products` (Cmd+K) had no rate limit | Medium | **Fixed** + test |
| SEC-V3-02 | `images.remotePatterns` allowed all of `res.cloudinary.com` (any tenant) | Medium | **Fixed** + test |
| SEC-V3-03 | `DailyCap` is per worker process / in memory (resets on restart, multiplies with replicas) | Low | Fixed (V3-14): `RedisDailyCap`, UTC-day Redis counter shared across replicas, fails closed |
| SEC-V3-04 | Public summary payload exposes `model` and `generatedAt` | Low / info | Open, accepted unless product objects |
| SEC-V3-05 | Reviewer-supplied third-party names are not stripped from summary input, and output is not name-checked | Low | Fixed (V3-14): names masked in model input (`maskNames`) and output rejected by `containsName` (heuristic) |
| SEC-V3-06 | Search uses `name contains q`; LIKE wildcard (`%`, `_`) handling by Prisma/MySQL not asserted by a test | Low | Fixed (V3-14): test in `apps/web/src/server/api.test.ts` | |
| SEC-V3-07 | Cloudinary: delivery transformations are not locked (ops setting "strict transformations") and signature uses SHA-1 | Low | Open, owner: DevOps |
| SEC-V3-08 | Charts dependency not present; nothing to audit | Info | n/a |

No Critical or High findings.

## (a) Gemini review summaries (worker)

Controls verified:
- **Prompt injection.** Review text reaches the model only as JSON-escaped data in the user message (`buildSummaryUserMessage`); the system prompt declares reviews untrusted and forbids links, emails, phones, names, quotes. Input is cleaned (`stripLinksAndPii`: NFC, control/bidi/zero-width chars, markup, links, emails, bare domains, phones) and clipped (150/800 chars, max 50 reviews). Only PUBLISHED, non-deleted, non-excluded reviews are sources.
- **ADR-0028 canary reuse.** Output strings go through `looksLikeInjection` (instruction-echo canary); a hit yields `injection`, which hides an existing summary (`INJECTION_CANARY`) and never saves. Output is strict-schema (zod `.strict()`, 3-5 items, length caps, <=2 sentences), re-stripped, checked with `checkReplyPolicy` (link/email/markup/invisible/phone), and then run through the moderation provider; unavailable moderation fails closed (never saved).
- **Escaping before render.** `AiSummaryCard` renders strings as React text nodes (no `dangerouslySetInnerHTML`); stored text has markup stripped at write time as defence in depth. Result: stored-XSS via a poisoned summary is not reachable.
- **PII.** Reviewer identity is not sent to the model (only n, rating, verified flag, title, body). Stored row holds `sourceReviewIds` (internal) and is not exposed publicly. Residual: SEC-V3-05.
- **Rate/cost limits.** Debounce per (product, language) via deterministic BullMQ `jobId` and 15 min delay; min 5 reviews; max 3 attempts with backoff honouring Retry-After; circuit breaker (10-call window, 50 % failure, 5 min open); daily call cap (`SUMMARY_DAILY_CAP`, default 500). Residual: SEC-V3-03.
- **Kill switch.** `AI_REVIEW_SUMMARY_ENABLED` defaults OFF (only `true|on|1` enable); checked in scheduling, the job, and the public read path (`loadAiSummary`), so turning it off hides existing summaries immediately.
- **Failure handling.** Retryable errors throw `SummaryRetryError` (previous READY row stays visible); non-retryable ones mark FAILED only when no summary exists. Logs contain ids and reason codes, not review text or keys. API key goes in the `x-goog-api-key` header only (env names `SUMMARY_API_KEY` / `MODERATION_API_KEY`); provider errors never echo the cause. Model name is regex-validated.

## (b) Cloudinary signed uploads

- **There is no browser-facing signing endpoint.** Signing happens only inside the worker (`createCloudinaryStore.signed`) after ClamAV, sanitising and moderation approval; only the public bucket is routed to Cloudinary (MED-037). Therefore no one can ask the platform to sign arbitrary params, and "who can call the sign endpoint" = nobody over HTTP.
- **Signature scope.** Signed params: `public_id`, `overwrite=false`, `unique_filename=false`, `use_filename=false`, `timestamp` (+ `eager`/`eager_async` for video, `invalidate` for destroy). `public_id` derives from server-generated keys (`m/<id>/<variant>`), never from user input, so folder/public_id are fully server-controlled; `overwrite=false` prevents replacing an existing asset. Timestamp is from the injected Clock (ADR-0024).
- **Formats/size.** Enforced before upload by the media pipeline (ADR-0006/0012); the store `get` caps bytes (`MediaTooLargeError`). Cloudinary-side `allowed_formats` is not set (content already validated), acceptable.
- **Secret handling.** `CLOUDINARY_API_SECRET` (with `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`) read from env only in the worker; used for the signature and Basic auth header; not logged; failure messages include only HTTP status and Cloudinary's error message. Web needs only `CLOUDINARY_CLOUD_NAME` (non-secret). Do not set the secret in the web service env.
- Residual SEC-V3-07: enable "Strict transformations" on the Cloudinary account so only the `f_auto,q_auto` / `q_auto,vc_auto` delivery transformations can be requested; SHA-1 is Cloudinary's default and acceptable, SHA-256 is available via `signature_algorithm` if desired.

## (c) next/image remotePatterns and CSP

- **SEC-V3-02 (fixed).** `res.cloudinary.com` was allowed with no path restriction, so `/_next/image?url=https://res.cloudinary.com/<any-cloud>/...` made our server fetch, transform and cache any tenant's content (bandwidth/cost abuse, content laundering through our origin). Now pinned to `/${CLOUDINARY_CLOUD_NAME}/**`; no Cloudinary host is allowed without a valid cloud name. Test: `apps/web/src/server/v3-security.test.ts`.
- **CSP.** Nonce + `strict-dynamic` scripts, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri/form-action 'self'`. Cloudinary is added to `img-src`/`media-src`/`connect-src` only when `MEDIA_PUBLIC_STORE=cloudinary`, host-level (path scoping is not supported in a robust way for redirects; the optimiser scoping above covers the server side). Fonts: `next/font/google` self-hosts Inter at build time, so `font-src 'self' data:` needs no third-party font origin and none is allowed. `style-src 'unsafe-inline'` is a known, documented trade-off (scripts remain strict). `/_next/image` is outside the middleware matcher (no CSP on image bytes; nosniff is set by Next).

## (d) Cmd+K instant search (`GET /api/products?q=`)

- **Enumeration of hidden/unpublished products.** Query is hard-filtered to `status: "ACTIVE"`; `select` is `productSelect`; image resolver returns only approved/published images; `getProduct` also requires ACTIVE. No draft/hidden product is reachable by name search. Page size is validated by `pageQuery`; `q` is trimmed 1-100 chars.
- **Injection.** Prisma parameterises `name contains q` (no raw SQL). Results are rendered by React (escaped); the palette navigates to hrefs built from slugs. Residual SEC-V3-06: assert wildcard behaviour (`%`/`_` only widen matching within ACTIVE products, no data exposure).
- **Rate limiting (SEC-V3-01, fixed).** The route had no limiter although the typeahead is unauthenticated and issues a `findMany` + `count` + image lookup per keystroke burst. Added `limitPublicRead` (120 req/min/IP, shared with other public reads; the client debounces and aborts in-flight requests). Test in `v3-security.test.ts`.

## (e) Dependencies

`pnpm audit --prod`: **No known vulnerabilities found** (run in this task).

| Package | Version (web) | Licence |
|---|---|---|
| radix-ui | 1.8.1 | MIT |
| cmdk | ^1.1.1 | MIT |
| motion | 14.14.0 | MIT |
| lucide-react | 1.77.0 | ISC |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| clsx | ^2.1.1 | MIT |
| tailwind-merge | 3.7.1 | MIT |
| next-themes | 0.4.6 | MIT |
| tw-animate-css | 1.4.0 | MIT |
| tailwindcss / @tailwindcss/postcss | ^4.3.5 | MIT |

All permissive and compatible with proprietary distribution (Apache-2.0 and ISC need notice retention). No chart library (e.g. recharts) is installed in this tree, so there is nothing to review (SEC-V3-08); re-run the audit when one is added. Several pins are exact (good); `cmdk`, `clsx` use caret ranges, the lockfile pins resolved versions.

## Follow-ups
1. SEC-V3-03: move the summary daily cap to Redis (shared across worker replicas) or set `SUMMARY_DAILY_CAP` per-replica accordingly.
2. SEC-V3-05: optionally add a capitalised-name heuristic to output validation, or accept and rely on moderation + disclaimer.
3. SEC-V3-06: add a test for `q` containing `%`/`_`.
4. SEC-V3-07: enable Cloudinary strict transformations (DevOps).
