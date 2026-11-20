# Review Platform: Documentation

Responsive web product-review platform: AI-first + admin moderation, verified-buyer labels, media uploads,
trust scores, comparison and social features.

**Phase 1** includes everything except messaging. **Messaging is Phase 2 and explicitly out of scope** (see
[data-model.md §1.2](./architecture/data-model.md#12-explicitly-out-of-scope-messaging-phase-2)).

## Architecture

| Document | Purpose |
|---|---|
| [architecture/data-model.md](./architecture/data-model.md) | Phase 1 ERDs, entity rules, lifecycles (moderation, verified-buyer proof redaction/deletion, ownership proof, enforcement/appeals, trust inputs), retention |
| [architecture/schema.draft.prisma](./architecture/schema.draft.prisma) | Prisma schema draft (MySQL), the source of truth for columns, types and indexes |
| [architecture/check-constraints.sql](./architecture/check-constraints.sql) | CHECK constraints Prisma cannot express (exclusive arcs, ranges) |
| [architecture/open-questions.md](./architecture/open-questions.md) | **Legal: OPEN**, **Language: OPEN**, plus technical/product questions with working assumptions |

## Decisions (ADRs)

See [adr/README.md](./adr/README.md).

| ADR | Decision |
|---|---|
| [0001](./adr/0001-technology-stack.md) | Next.js + Tailwind, Prisma/MySQL 8, R2 (public + private buckets), BullMQ/Redis worker with a transactional outbox |
| [0002](./adr/0002-authentication-and-2fa.md) | First-party server-side sessions, Argon2id, Google OIDC, TOTP 2FA (mandatory for staff and seller owners/managers), step-up auth |
| [0003](./adr/0003-multi-role-permissions.md) | Additive RBAC (DB-stored roles, code-defined permissions) + seller-scoped roles + policy guards (restrictions, 2FA, COI, step-up) |
| [0004](./adr/0004-data-model-conventions.md) | cuid IDs, exclusive arcs with CHECKs, soft delete + retention purge, caches, append-only tables, PII minimization |
