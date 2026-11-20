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
| [architecture/moderation-pipeline.md](./architecture/moderation-pipeline.md) | Moderation verdicts, content state machine, timers (24 h post-review, 7-day hold), configurable thresholds, staff queues (moderation, appeal, seller verification), BullMQ job design |
| [architecture/moderation-config.example.json](./architecture/moderation-config.example.json) | Example versioned moderation config (thresholds, timers, AI failure handling, strikes) |
| [architecture/media-pipeline.md](./architecture/media-pipeline.md) | Direct upload, virus scan, EXIF/GPS strip, 720p video transcode, bucket/key layout, retention, scan/upload logs |
| [architecture/open-questions.md](./architecture/open-questions.md) | **Legal: OPEN**, **Language: OPEN**, plus technical/product questions with working assumptions |

## Decisions (ADRs)

See [adr/README.md](./adr/README.md).

| ADR | Decision |
|---|---|
| [0001](./adr/0001-technology-stack.md) | Next.js + Tailwind, Prisma/MySQL 8, R2 (public + private buckets), BullMQ/Redis worker with a transactional outbox |
| [0002](./adr/0002-authentication-and-2fa.md) | First-party server-side sessions, Argon2id, Google OIDC, TOTP 2FA (mandatory for staff and seller owners/managers), step-up auth |
| [0003](./adr/0003-multi-role-permissions.md) | Additive RBAC (DB-stored roles, code-defined permissions) + seller-scoped roles + policy guards (restrictions, 2FA, COI, step-up) |
| [0004](./adr/0004-data-model-conventions.md) | cuid IDs, exclusive arcs with CHECKs, soft delete + retention purge, caches, append-only tables, PII minimization |
| [0005](./adr/0005-moderation-state-machine.md) | Three AI verdicts (CLEAN→live+post-review, VIOLATION→rejected, UNSURE/failure→hidden 7-day hold), DB-deadline timers, versioned thresholds, DB-view staff queues |
| [0006](./adr/0006-media-storage-and-processing.md) | Ingest/private/public buckets (amends ADR-0001 upload path), fail-closed scan + sanitise + transcode pipeline, promote/demote with moderation |

## Security

| Doc | Content |
|---|---|
| [security/threat-model.md](./security/threat-model.md) | STRIDE threat model of the M1 designs, design gaps, rate-limit baseline, mitigations mapped to M2-M8 |

## Design

| Doc | Content |
|---|---|
| [../design/README.md](../design/README.md) | Wireframes for all key flows, design tokens (light/dark, Tailwind preset), WCAG 2.2 AA checklist |
