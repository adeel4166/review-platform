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
| [architecture/moderation-lifecycle.md](./architecture/moderation-lifecycle.md) | **Authoritative transition table**: lifecycle states (submitted, auto-screened, pending manual review, published, rejected, appealed, reinstated, removed), state diagram, actors, audit actions, revision and appeal sub-machines |
| [architecture/job-catalogue.md](./architecture/job-catalogue.md) | **Authoritative job list**: outbox events and fan-out routes, job ids, zod payloads, retry/back-off policy, sweepers, media failure handling |
| [architecture/media-pipeline.md](./architecture/media-pipeline.md) | Direct upload, virus scan, EXIF/GPS strip, 720p video transcode, bucket/key layout, retention, scan/upload logs |
| [architecture/open-questions.md](./architecture/open-questions.md) | **§0 For CEO review (C-1..C-9)**, **Legal: OPEN**, **Language: OPEN**, plus technical/product questions with working assumptions |
| [design/README.md](./design/README.md) | Wireframes, design tokens, WCAG 2.2 AA checklist, i18n layout rules (index; sources in `/design`) |

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
| [0007](./adr/0007-queue-based-worker.md) | Worker/outbox contract: MySQL is truth, only the outbox enqueues, `SKIP LOCKED` relay, id-only payloads, idempotency rules, `core`/`media`/`media-video` deployment groups |
| [0008](./adr/0008-verified-buyer-approach.md) | Per-review "Verified purchase" label, human-decided with AI assist, independent of publication, provenance via `Review.verifiedProofId`, files purged, label survives |
| [0009](./adr/0009-i18n-readiness.md) | English default, next-intl + ICU keys (no literals), `as-needed` locale prefix later, store keys not rendered text, legal text stored with its locale |
| [0010](./adr/0010-database-physical-naming.md) | Lowercase snake_case plural tables via `@@map`, camelCase columns (amends ADR-0004) |
| [0011](./adr/0011-moderation-lifecycle-and-audit.md) | Appealed/reinstated are derived states; report count never hides content (F-9); T15–T21 added; one `AuditLog` row per transition with `<entity>.<verb>` actions (amends ADR-0005) |
| [0012](./adr/0012-media-job-decomposition.md) | `media.scan` → `media.image` / `media.transcode` step jobs; decoders read only a sha256-verified staging copy of the scanned bytes (amends ADR-0006) |
| [0013](./adr/0013-outbox-fan-out-routing.md) | One outbox event → many jobs, domain job keys with `__` separator, delayed routes (refines ADR-0007) |

## Security

| Doc | Content |
|---|---|
| [security/threat-model.md](./security/threat-model.md) | STRIDE threat model of the M1 designs, design gaps, rate-limit baseline, mitigations mapped to M2-M8, appeals and moderation-tooling threats, secrets/GitHub-token/storage least privilege (§9), M2 security checklist (§10) |

## QA

| Doc | Content |
|---|---|
| [qa/test-strategy.md](./qa/test-strategy.md) | Test levels, tooling, rules, timer and state-machine test designs, media fixtures, authz matrix tests, QA gate criteria for M2–M8 |
| [qa/test-case-catalogue.md](./qa/test-case-catalogue.md) | Stable test case IDs linked to M2–M8, with priority, source section and threat coverage |

## Design

| Doc | Content |
|---|---|
| [../design/README.md](../design/README.md) | Wireframes for all key flows, design tokens (light/dark, Tailwind preset), WCAG 2.2 AA checklist |

## Development

| Doc | Content |
|---|---|
| [../README.md](../README.md) | Repo layout, one-command local run, QA gate and CI |
