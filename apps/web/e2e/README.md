# E2E tests (Playwright)

Browser journeys for the review flow: sign up and sign in, submit a review (with a photo), AI moderation
(mock provider) auto-approve, needs-human and reject paths, admin approve and reject, and the public result
(published reviews visible, rejected reviews hidden, Verified buyer badge).

Quarantined and known-gap tests are listed in [QUARANTINE.md](./QUARANTINE.md).

## What the suite needs

The suite talks to a real stack. Nothing is mocked in the browser.

| Piece | Why | CI (`.github/workflows/ci.yml`, job `e2e`) |
|---|---|---|
| MySQL 8, migrated and seeded | Users, products, reviews, cases | service container, `migrate:deploy` + `seed` |
| Redis 7 | BullMQ queues and outbox | service container |
| MinIO with buckets `rp-ingest`, `rp-private`, `rp-public` | Presigned photo upload | `docker run` + `mc mb` |
| Worker (`apps/worker`) | Runs AI moderation (mock provider) and publishes | started in background |
| Web app from a production build | Browser target, started by Playwright `webServer` | `pnpm build` then `pnpm start` |

Environment variables the tests read:

- `E2E_ADMIN_PASSWORD` (required): must equal `SEED_ADMIN_PASSWORD` used by the seed.
- `E2E_ADMIN_EMAIL` (optional, default `admin@example.com`).
- `E2E_PORT` (optional, default `3000`).
- Everything the web app and worker need (`DATABASE_URL`, `REDIS_URL`, `S3_*`, `AUTH_SECRET`, `AUTH_TRUST_HOST`).

Use throwaway values only. Never point the suite at a database with real data.

## Run locally

```bash
pnpm infra:up                                    # MySQL, Redis, MinIO (docker compose)
pnpm --filter @rp/db migrate:deploy
SEED_ADMIN_PASSWORD=... SEED_USER_PASSWORD=... pnpm --filter @rp/db seed
pnpm build
pnpm --filter @rp/worker start &                 # moderation and outbox relay
pnpm --filter @rp/web exec playwright install chromium
E2E_ADMIN_PASSWORD=... pnpm --filter @rp/web test:e2e
```

`test:e2e:quarantine` runs the quarantined tests on their own.

## Conventions

- Every test title starts with its ID (`E2E-MOD-001 ...`) so reports map back to the catalogue.
- Tests create their own users, emails and review titles (`uniqueTag()`), so they can run in parallel.
- Moderation is asynchronous: wait with `expect.poll` or `toPass`, never with fixed sleeps.
- Clean text, one blocklist word and two blocklist words give APPROVED, NEEDS_HUMAN and REJECTED from the mock provider.
- A test that depends on the worker must not pass without it. Failures there are real, not retried into green.

## Coverage of backend services

`pnpm coverage` (repo root) runs Vitest with the v8 coverage provider for `@rp/core`, `@rp/worker` and `@rp/web`.
Reports land in each package's `coverage/` folder (git-ignored). CI uploads them as a build artifact.
It reports only; there is no threshold gate yet.

## Seller journeys (`seller.spec.ts`, M3-06)

Needs Mailpit (`pnpm infra:up` starts it; the worker must send through it, `SMTP_URL=smtp://127.0.0.1:1025`). Optional
`E2E_MAILPIT_URL` (default `http://localhost:8025`). The tests read the confirmation and invitation links from Mailpit.
The DNS verifier is mocked at the browser boundary (the wizard's status poll); the worker's SSRF-guarded egress is not
touched. The admin approval test uses the seeded admin.

## M3b-07 journeys

`two-factor.spec.ts` (enrol, authenticator and recovery-code login, pending-session gate, axe in light and dark),
`ownership-transfer.spec.ts` (request, countdown, cancel) and `seller-reply.spec.ts` (composer, pending state, admin queue,
public display). They need `TOTP_ENC_KEYS`, `TOTP_ENC_ACTIVE_KEY_ID`, `RECOVERY_CODE_PEPPERS` and
`RECOVERY_CODE_ACTIVE_KEY_ID` in the web environment (throwaway values are set in the CI `e2e` job). The reply spec claims the
seeded product for a new seller, so run it against a fresh database.

## M6/M7 UI journeys (task #80)

`m6-hold-appeal.spec.ts` (E2E-002..005), `m6-coi.spec.ts` (E2E-008) and `m6-queue-keyboard.spec.ts` (A11Y-004) seed their own
cases and deadlines through `@rp/db` (`m6-helpers.ts`, ADR-0024: no runtime test clock), so the Playwright environment also needs
`DATABASE_URL`. E2E-003 and E2E-004 need the worker running (the sweeper resolves the expired hold). Staff accounts are made by
registering a user and granting `ADMIN` in the database.

## Social, four-eyes and erasure specs (DEF-LIVE-03)

`search-compare`, `vote-report`, `follow-notifications` and `role-grant-erasure` (helpers in `social-helpers.ts`). Staff actors enrol TOTP through the real wizard. They need `DATABASE_URL` in the Playwright env (as `m6-helpers.ts`). `E2E-FOL-2` is `test.fail` (DEF-LIVE-06/07) and `E2E-ERASE-2` is `test.fixme` (DEF-LIVE-08); see `docs/qa/live-gate-report.md`.
