# Review Platform

Next.js + Tailwind web app, Prisma/MySQL, S3-compatible storage and a BullMQ background worker. Architecture is in [`docs/`](docs/README.md) (start with ADR-0001).

## Layout

```
apps/web      Next.js (App Router) UI, Server Actions, route handlers; /api/health
apps/worker   Outbox relay + BullMQ processors (moderation, media stubs)
packages/db   Prisma schema (scaffold: outbox only) + client singleton
packages/core Shared zod schemas: env, queue names, job payloads
design/       Tokens, Tailwind preset, wireframes (M1.4)
```

## Run locally (one command)

Requires Node 20+, Docker (with Compose v2) and Corepack (ships with Node).

```bash
corepack enable && pnpm start:local
```

This copies `.env.example` to `.env` (if missing), installs deps, starts MySQL 8, Redis 7 and MinIO (buckets `rp-ingest`, `rp-private`, `rp-public`), applies the Prisma schema, then runs web (http://localhost:3000) and worker in watch mode. MinIO console: http://localhost:9001. Stop infra with `pnpm infra:down`.

`.env` is git-ignored. The values in `.env.example` are throwaway local defaults, never real secrets.

## Quality gate

```bash
pnpm qa      # eslint, tsc (all packages), vitest, prisma validate, design token drift + WCAG contrast
pnpm build
```

CI (`.github/workflows/ci.yml`) runs the same `pnpm qa` and `pnpm build` on every push to `main`/`task/**` and on PRs, plus `docker compose config` validation. Tests today need no running services. The Phase 1 test strategy and case catalogue are in [`docs/qa/`](docs/qa/test-strategy.md). The review-flow E2E suite (Playwright, job `e2e` in CI, run against a seeded stack) is in [`apps/web/e2e/`](apps/web/e2e/README.md), with quarantined tests listed in [`QUARANTINE.md`](apps/web/e2e/QUARANTINE.md). `pnpm coverage` reports coverage for the backend services. Integration tests are still to come.

## Adding a queue/job

1. Add the name and zod payload to `packages/core/src/queues.ts`.
2. Register a processor in `apps/worker/src/processors.ts` (must be idempotent).
3. Map the outbox event type in `apps/worker/src/outbox.ts` `routes`.

## Database, auth and API (M2-1)

```bash
pnpm infra:up
pnpm --filter @rp/db migrate:deploy   # applies packages/db/prisma/migrations
pnpm --filter @rp/db seed             # idempotent demo data (admin@example.com, user@example.com)
```

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/register` | – | email, password (10-128), handle, displayName |
| `/api/auth/*` | – | Auth.js (credentials, JWT sessions; role `user`/`admin`) |
| `GET /api/products` | – | `?page&pageSize&category&q`, ACTIVE only |
| `GET /api/products/:idOrSlug` | – | |
| `GET /api/products/:id/reviews` | – | PUBLISHED only, paginated |
| `POST /api/products/:id/reviews` | user | `{rating 1-5, title, body}`; starts `PENDING` |
| `PATCH/DELETE /api/reviews/:id` | author | only while `PENDING` (delete is soft) |
