# M2 hardening QA gate report (task #42, M2-13)

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Branch** | `task/42` |
| **Scope** | Hardening regression suite, admin authz matrix, GPS-EXIF fixture, presigned PUT signing check, regression pins for M2-8..M2-12 |
| **Catalogue** | [test-case-catalogue.md](./test-case-catalogue.md) |
| **Security record** | [m2-security-review.md](../security/m2-security-review.md), "Verification record (M2-13, task #42)" |

## Result

| Layer | Command | Result |
|---|---|---|
| Unit, core | `pnpm --filter @rp/core test` | **49 passed** (47 before, +2) |
| Unit, worker | `pnpm --filter @rp/worker test` | **25 passed** (24 before, +1) |
| Unit, web | `pnpm --filter @rp/web test` | **128 passed** (109 before, +19) |
| Lint | `pnpm lint` | pass |
| Typecheck | `pnpm typecheck` | pass |
| Design tokens and contrast | `pnpm design:check` | pass |
| E2E (chromium gate) | `pnpm --filter @rp/web test:e2e` | **not run here**: needs MySQL, Redis, MinIO and a built app. Runs in CI. |
| MinIO runtime signing check | `docker compose up -d minio` + PUT with extra bytes | **not run here**: no Docker in this sandbox. Pending. |

Unit tests ran with `DATABASE_URL` set to the throwaway CI value, because `prisma validate` requires it.

## New cases

| ID | Lvl | SEC id | Case | Result |
|---|---|---|---|---|
| AZ-025 (matrix guard) | U | SEC-09(a) | Discovered `route.ts` files under `/api/admin` equal the table (5 routes) | **pass** |
| AZ-025 (anonymous) | U | SEC-09(a) | 5 routes → 401 | **pass** (5/5) |
| AZ-025 (non-admin) | U | SEC-09(a) | 5 routes → 403 | **pass** (5/5) |
| AZ-025 (admin control) | U | SEC-09(a) | 5 routes, admin passes the guard | **pass** (5/5) |
| MED-039 | I | SEC-08(c) | GPS-tagged JPEG → READY; thumb and medium have no EXIF, WebP EXIF chunk, XMP/IPTC or camera/owner strings | **pass** |
| SEC-013 (signed length) | U | SEC-07(1) | Presigned PUT lists `content-length` in `X-Amz-SignedHeaders` | **pass** |
| SEC-013 (size bound) | U | SEC-07(1) | Different declared size → different signature | **pass** |
| SEC-014 (next-auth pin) | U | SEC-01 / M2-8 | next-auth ≥ 5.0.0-beta.32 | **pass** |
| SEC-014 (audit gate) | U | SEC-01 / M2-8 | CI has `pnpm audit --prod --audit-level=high` | **pass** |
| SEC-014 (anchors) | U | SEC-02..13 / M2-9..12 | Named regression suites exist and contain their SEC markers | **pass** |
| E2E-012 (anonymous) | E | SEC-09(a) | 5 admin calls over HTTP → 401 | **not run** (CI) |
| E2E-012 (non-admin) | E | SEC-09(a) | 5 admin calls over HTTP as a signed-in user → 403 | **not run** (CI) |

## Regression coverage for M2-8..M2-12 (existing suites, re-run green)

| Task | Finding | Pinned by | Result |
|---|---|---|---|
| M2-8 | SEC-01 dependency upgrade and audit gate | SEC-014 | pass |
| M2-9 | SEC-02 media on non-PENDING reviews | `media.test.ts` "media on non-PENDING reviews (SEC-02)" | pass |
| M2-10 | SEC-03 rate limits and quotas, SEC-05 | `ratelimit.test.ts`, `media.test.ts` "upload quota (SEC-03)" | pass. SEC-05 (INSERT-only AuditLog) has no test; it needs a MySQL grant check |
| M2-11 | SEC-04/06 headers and origin, SEC-09 admin | `security.test.ts`, AZ-025, E2E-012 | pass (unit). E2E-012 not run here |
| M2-12 | SEC-13 login and register pages | `auth.spec.ts` (E2E-AUTH-001..005), `callback-url.test.ts` | unit pass. E2E not run here |

## Gaps and open items

1. **MinIO runtime check (SEC-07(1))** is pending. The SDK-level result is recorded, but the runtime check has not been run.
2. **`content-type` is not signed** in presigned PUTs (SEC-07 side finding, Low). The worker's magic-byte check bounds the impact. Security should decide whether to sign it.
3. **E2E-012 and CI** have not run in this sandbox. The gate is green only once CI's e2e job passes.
4. **SEC-09(b)** (self-approval block) and **SEC-05** (AuditLog INSERT-only) are not in this task's scope and have no new test.
5. The admin pass-through control logs "unhandled route error" to stderr because the DB is a stub. It is expected noise.

## Verdict

Unit, lint, typecheck and design gates pass locally. Sign-off on SEC-07(1) waits for the MinIO or R2 runtime check. E2E-012 waits for CI.
