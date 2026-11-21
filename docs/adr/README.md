# Architecture Decision Records

We record significant architecture decisions as ADRs (lightweight Michael Nygard format).

## Rules

- One decision per file: `NNNN-kebab-title.md`, numbered sequentially and never reused.
- New ADRs start as **Proposed**. An ADR becomes **Accepted** when its PR is merged to `main` with CEO approval.
- Accepted ADRs are not rewritten. To change a decision, add a new ADR and mark the old one **Superseded by ADR-NNNN**.
- Small clarifications (typos, links, follow-up status) may be edited in place.
- Use [`template.md`](./template.md).

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](./0001-technology-stack.md) | Technology stack and runtime topology | Accepted | 2026-11-20 |
| [0002](./0002-authentication-and-2fa.md) | Authentication, sessions and two-factor authentication | Accepted | 2026-11-20 |
| [0003](./0003-multi-role-permissions.md) | Multi-role permission model | Accepted | 2026-11-20 |
| [0004](./0004-data-model-conventions.md) | Data model conventions | Accepted | 2026-11-20 |
| [0005](./0005-moderation-state-machine.md) | Moderation state machine, timers and work queues | Accepted | 2026-11-20 |
| [0006](./0006-media-storage-and-processing.md) | Media storage layout and processing pipeline (amends ADR-0001 §5) | Accepted | 2026-11-20 |
| [0007](./0007-queue-based-worker.md) | Queue-based background worker and transactional outbox contract | Proposed | 2026-11-21 |
| [0008](./0008-verified-buyer-approach.md) | Verified-buyer approach | Proposed | 2026-11-21 |
| [0009](./0009-i18n-readiness.md) | Internationalisation readiness (English default) | Proposed | 2026-11-21 |
| [0010](./0010-database-physical-naming.md) | Database physical naming (amends ADR-0004) | Proposed | 2026-11-21 |

### Task #24 coverage map (stack, storage, worker, verified buyer, i18n)

| Required topic | ADR |
|---|---|
| Stack (Next.js + Prisma/MySQL) | [0001](./0001-technology-stack.md), [0004](./0004-data-model-conventions.md), [0010](./0010-database-physical-naming.md) |
| Object storage (S3/R2) | [0001](./0001-technology-stack.md) §1/§5, [0006](./0006-media-storage-and-processing.md) |
| Queue-based worker | [0007](./0007-queue-based-worker.md) (builds on 0001 §4, 0005, 0006) |
| Verified-buyer approach | [0008](./0008-verified-buyer-approach.md) |
| i18n readiness (English default) | [0009](./0009-i18n-readiness.md) |
