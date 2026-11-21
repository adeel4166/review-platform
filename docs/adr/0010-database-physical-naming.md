# ADR-0010: Database physical naming (amends ADR-0004)

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-21 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #24 (M1-T1) |
| **Related** | ADR-0004 (data model conventions), ADR-0007 §3 (outbox table), [schema.draft.prisma](../architecture/schema.draft.prisma), [check-constraints.sql](../architecture/check-constraints.sql), scaffold `packages/db/prisma/schema.prisma` |

## Context

The M1.1 draft used Prisma's default physical names, so the tables were called `User`, `MediaAsset`, `Like` and so on. The M1.5 scaffold, which is the only schema that
actually runs today, maps its one table to `outbox_events`. Two conventions now exist side by side. **No domain table has been migrated yet**, so this is the
cheapest moment to choose. Later, every rename would be a migration on a live table.

Forces:

- MySQL table names are file-system backed. **`lower_case_table_names` defaults to 0 (case-sensitive) on Linux, 1 on Windows and 2 on macOS,
  and in MySQL 8 it can only be set when the server is initialised.** Mixed-case names such as `MediaAsset` behave differently on developer laptops and on
  Linux servers, and that breaks dumps and restores between them. Some managed offerings fix the value (T-10).
- `Like` is a **reserved word** in MySQL. Every raw SQL statement against it must quote it. Snake-case plurals (`likes`) avoid reserved words entirely.
- Raw SQL already exists, in the CHECK constraints and the planned staff-queue views, and more will come with retention jobs and BI exports.
- MySQL **column** names are case-insensitive on every platform, so camelCase columns carry no portability risk.

## Decision

1. **Tables are lowercase snake_case plurals**, declared with `@@map` on every model: `User` → `users`, `MediaAsset` → `media_assets`,
   `TwoFactorTotp` → `two_factor_totps`, `OAuthAccount` → `oauth_accounts`, `WebAuthnCredential` → `webauthn_credentials`.
   Join tables keep their model name in plural form (`user_roles`, `comparison_items`).
2. **Columns keep the Prisma field name (camelCase), with no `@map`.** Adding `@map` on every field would add noise without any portability gain.
3. **Index, unique and FK names** use Prisma's defaults (`<table>_<cols>_idx|_key|_fkey`), which are derived from the mapped table name. Every name
   must stay within MySQL's 64-character limit. The draft's longest is 57 characters, checked by generating its DDL. A longer name gets an explicit `map:`.
4. **CHECK constraints** are named `chk_<table-or-entity>_<rule>` and always reference *table* names, never model names.
5. Prisma model names, and therefore the Prisma Client API, stay PascalCase. Application code is unaffected. Only raw SQL sees the table names.
6. Because every table name is lowercase, **every `lower_case_table_names` value (0, 1 or 2) behaves the same**, so servers keep their platform default.
   This is the point of the decision: no server setting to get right.

The draft schema and `check-constraints.sql` were updated in this task, and the generated DDL confirms 42 tables. The scaffold's
`outbox_events` already complies.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep Prisma defaults (PascalCase tables) and drop the scaffold's `@@map` | One annotation fewer per model, but it brings the cross-platform `lower_case_table_names` problem and quoting of reserved words (`Like`) into every raw query |
| snake_case for columns too (`@map` on every field) | Hundreds of annotations, and more room for mistakes when fields are added. Columns are case-insensitive, so there is no portability benefit |
| Singular table names (`user`, `media_asset`) | `USER` is a MySQL keyword (`USER()`, `CREATE USER`) and would need care in raw SQL. Plural is the common convention, and it matches the scaffold's `outbox_events` |

## Consequences

**Positive:** portable dumps and restores across macOS, Windows and Linux, no reserved-word quoting, readable SQL for staff-queue views, retention jobs and BI,
and one convention shared by the scaffold and the draft.

**Negative:** one `@@map` line per model, and developers must remember that raw SQL uses table names, not model names. Mitigation: the CHECK
file header says so, and the schema convention block in `schema.draft.prisma` documents it.

## Follow-ups

- Feature tasks copy models together with their `@@map` lines when they adopt them into `packages/db`.
- Code review: reject raw SQL that uses model names (e.g. `MediaAsset`) instead of table names. The migration fails fast on Linux anyway.
