# ADR-0004: Data model conventions

| | |
|---|---|
| **Status** | Accepted (merged to `main` with CEO approval, proposal #8). Amended by [ADR-0010](./0010-database-physical-naming.md) (table naming) |
| **Date** | 2026-11-20 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #18 (M1.1) |
| **Related** | ADR-0001, [schema.draft.prisma](../architecture/schema.draft.prisma), [check-constraints.sql](../architecture/check-constraints.sql), [data-model.md](../architecture/data-model.md) |

## Context

The Phase 1 schema has 40 models. Several of them refer to "one of many" targets: reports, moderation cases, comments, likes, follows,
appeals and media attachments. User content must stay available as moderation evidence, and verified-buyer proofs must be redacted and purged on a schedule.
We are on MySQL 8 with Prisma. MySQL has no partial indexes and no row-level security, and Prisma cannot declare CHECK constraints. Without written conventions, each feature team would solve these problems
differently.

## Decision

### 1. Identifiers

- Primary keys are `String @default(cuid())`. They are collision-resistant, can be generated client-side for optimistic UI, do not reveal row counts the way sequential integers would, and
  are roughly time-ordered, which keeps InnoDB clustered-index inserts local.
- **Exceptions:** `AuditLog` and `OutboxEvent` use `BigInt @default(autoincrement())`. These are append-only, high-volume tables that need strict
  insertion order for relays and archival, and they are never exposed in URLs.
- Composite primary keys are used for pure join/edge tables (`UserRole`, `SellerMember`, `ReviewVote`, `UserBlock`, `ComparisonItem`, `NotificationPreference`).
- Public URLs use `slug`/`handle` where a human-readable URL is wanted, and the cuid otherwise.

### 2. Time, text and charset

- All timestamps are UTC `DATETIME(3)` (Prisma default on MySQL). The app never stores local time. `@db.Date` is used only for calendar dates such as `purchaseDate`.
- Database/connection charset is `utf8mb4` with collation `utf8mb4_0900_ai_ci`. Unique string columns are ≤ 191 characters unless they are explicitly sized, and every explicitly sized index stays within InnoDB's 3072-byte key limit.
- Long user text uses `@db.Text`. Short text uses explicit `@db.VarChar(n)` limits that match the zod validation limits.

### 3. Polymorphic references: exclusive arcs

**Use an exclusive arc when referential integrity matters.** The table gets one nullable FK column per target type, and a CHECK constraint
requires exactly one (or at most one) of them to be non-null. Tables using this pattern: `Report`, `ModerationCase`, `Comment`, `Like`, `Follow`, `Appeal`,
`EnforcementAction`, `TrustSignal`, `TrustScoreSnapshot`, and `MediaAsset` (at most one).

Rules:

1. **Arc FKs are `onDelete: Restrict, onUpdate: Restrict`.** MySQL rejects a CHECK constraint on any column that is also used by a
   `CASCADE`/`SET NULL` foreign-key action (error 3823). Any CHECK on another FK column needs the same treatment, e.g. `SellerOwnershipClaim.productId`.
2. CHECKs live in `docs/architecture/check-constraints.sql` and are appended by hand to the initial migration. Any later migration that adds an
   arc member must drop and re-create the CHECK in the same migration.
3. Uniqueness over arcs uses one composite unique per arc member, e.g. `@@unique([userId, postId])` and `@@unique([userId, commentId])`. This works because
   MySQL unique indexes allow multiple NULLs.
4. The application validates the arc in zod as well, so users get a friendly error instead of a constraint violation.

**Use a loose reference (`entityType` + `entityId` strings, no FK) only when the row must outlive its target:** `AuditLog`, `Notification`.

**Rejected:** generic `targetType` + `targetId` columns everywhere (no integrity, orphan rows, and no FK-backed joins in Prisma), and one table per
target type (`ReviewReport`, `PostReport`, …), which would multiply moderation queue queries and code paths.

### 4. Deletion, status and purge

- **User-generated content is never hard-deleted by request handlers.** Removal is a `status` change (`ContentStatus`) plus `deletedAt` for author
  deletion. This keeps evidence for moderation, appeals and legal requests.
- **Users are never hard-deleted.** Erasure means anonymizing the `User` row in place, so it becomes a tombstone (`status = DELETED`, `anonymizedAt`) and FKs from content stay valid.
- **Physical purge happens only in retention jobs** in the worker. Because arc FKs are `Restrict`, purge jobs delete dependants explicitly in
  dependency order inside a transaction. This is deliberate: nothing disappears through an unnoticed cascade.
- `onDelete: Cascade` is used only for rows that have no meaning without their parent and carry no evidential value: sessions, tokens, 2FA records, votes,
  likes from a deleted user, wishlist and comparison items, notification preferences.
- `MediaAsset` rows outlive their objects. When a file is deleted from storage, the row is set to `status = PURGED` + `purgedAt` (tombstone). `legalHold = true` blocks every purge job.

### 5. Invariants MySQL can't express (enforced in code + tests)

These invariants are enforced in `packages/core` services, and each one has a dedicated integration test:

| Invariant | Why not in DB |
|---|---|
| At most one open `ModerationCase` per target | No partial unique index in MySQL |
| A seller always has ≥ 1 accepted `OWNER` | Cross-row rule |
| `SellerReply` only for products owned by a `VERIFIED` seller | Cross-table rule |
| No self-follow / self-block / self-vote | CHECK not possible on cascading FK columns (see §3 rule 1) |
| Appeal reviewer ≠ original decider | Cross-table rule |

(Possible future hardening: a generated column such as `openTargetKey` made unique, to enforce "one open case per target" in the database.)

### 6. Denormalized counters and caches

- Columns such as `helpfulCount`, `likeCount`, `commentCount`, `ratingAverage`, `ratingCount`, `reviewCount`, `trustScore` and `replyRate` are **caches**.
- They are updated by worker jobs triggered from `OutboxEvent`s, never by `UPDATE … SET x = x + 1` inside request transactions. This avoids
  hot-row lock contention on popular products.
- Each cache must have a rebuild job that recomputes it from source rows. Counts may lag by seconds, which is acceptable.

### 7. Append-only tables

`ModerationDecision`, `ReviewRevision`, `TrustSignal`, `TrustScoreSnapshot` and `AuditLog` are never updated. Corrections are made by appending a new row. `AuditLog` is
additionally protected by DB grants: the app user gets `INSERT, SELECT` only, and archival runs under a separate maintenance user.

### 8. Personal data minimization

- Secrets: store only hashes for session tokens, verification tokens and recovery codes (SHA-256 of high-entropy values) and for passwords (Argon2id).
  Store the TOTP secret encrypted with AES-256-GCM, together with a `keyId`.
- Identifiers that are needed only for matching (IP addresses, order numbers) are stored as **keyed HMAC-SHA-256** (`ipHash`, `orderReferenceHash`). The key lives in the secret manager.
- `Json` columns that come from AI output (`aiAssessment`, `labels`, `contentSnapshot`) must pass through a PII scrubber before they are persisted. Proof
  extraction keeps only the merchant, purchase date and product-match confidence.
- Sensitive media purposes are private-only (CHECK `chk_media_sensitive_private`) and are stored in a separate bucket with separate credentials.

### 9. JSON usage

`Json` is allowed only for (a) schemaless-by-design data validated in the app (`Product.specs` against `CategoryAttribute`), (b) provider
output and evidence snapshots, and (c) render parameters (`Notification.data`). Never use JSON for data that is filtered, joined or
needs referential integrity.

### 10. Migrations

- Use Prisma Migrate with a single linear history. Raw SQL (CHECKs, grants, future generated columns) goes inside migration files, never in ad-hoc scripts.
- Use expand → migrate → contract for any destructive change. No migration should hold a long table lock on `Review`, `MediaAsset` or `AuditLog`.

## Consequences

**Positive:** FK integrity even for polymorphic references, evidence that is not lost through cascades, clear rules about where personal data may appear,
and conventions that new contributors can follow.

**Negative:** CHECK constraints live outside the Prisma schema and must be maintained by hand. The `Restrict` arcs make purge jobs more verbose. Some
invariants depend on application code and tests rather than the database.
