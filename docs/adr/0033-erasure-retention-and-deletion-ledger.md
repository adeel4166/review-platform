# ADR-0033: Account erasure, one retention-job framework, tombstone expiry, and a deletion ledger outside database backups

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #77 (M6–M8 spec) |
| **Related** | data-model §6.6, §7 · open-questions L-4, L-5, L-11 · threat-model R-7 · security review SEC-M4-09 · [m6-m8-spec.md §22–§23](../architecture/m6-m8-spec.md#22-retention-and-privacy-jobs) · catalogue `PRV-011`, `PRV-012`, `OPS-001`, `OPS-006` |

## Context

1. SEC-M4-09: no erasure path deletes proofs when an **account** is deleted; `PROOF_ORIGINAL_RETENTION` is cast, not
   validated; proof tombstone hashes (`PurchaseProofFile.sha256`, `PurchaseProof.orderReferenceHash`) are kept forever.
2. Retention rules exist per area (media sweeps, proof sweeps, outbox purge) but not for every table in data-model §7
   (`OPS-006`).
3. `OPS-001`: after a database restore, rows from before a purge come back with `filesPurgedAt = NULL`; re-running
   deletion must not leave or re-create objects.

## Decision

1. **Erasure is a tracked job.** `DELETE /api/account` (step-up, typed confirmation) sets `User.status = DELETED`,
   revokes all sessions and creates an `ErasureRequest` row; `account.erase` (core group, idempotent, resumable by
   step) then: anonymises the user (handle → `former-<random>`, display name "Former user", email → a unique
   non-routable placeholder, bio/locale/timezone null, password and TOTP removed, OAuth links deleted); keeps
   published reviews with the author unlinked in the public DTO (L-4 working assumption); requests deletion of all
   proofs (`filesDeleteRequestedAt`) unless `legalHold`, and nulls `merchantName`, `purchaseDate`, `decisionNote`
   (SEC-M4-09 gap 1); demotes and purges all media owned by the user except under `legalHold`; deletes follows,
   blocks, notification rows and preferences; nulls `ipHash` on votes, reports and logs; keeps `AuditLog`,
   `ModerationDecision`, `EnforcementAction` and `TrustSignal` rows (accountability), which hold only the opaque user
   id. Each step records completion on the request; `completedAt` is set only after every purge verified 404.
2. **Retention framework.** `packages/core/src/retention/rules.ts` holds one rule per row of data-model §7
   (`{id, table, predicate(now), action: purge|null-columns|archive, batch}`), executed by
   `maintenance.retention` (daily 03:30 UTC, batches of 500, injected clock, `legalHold` always excluded). Durations come
   from a zod-validated env/config object; an unknown enum value (for example `PROOF_ORIGINAL_RETENTION`) refuses to
   boot (SEC-M4-09 gap 2). `OPS-006` iterates the rules with a `FakeClock`.
3. **Tombstone expiry:** proof file `sha256` and `orderReferenceHash` are nulled 12 months after `filesPurgedAt`
   (SEC-M4-09 gap 3); `BannedMediaHash` (abuse material) is exempt.
4. **Deletion ledger.** Every verified purge appends `{objectKey, entity, id, purgedAt}` to a daily NDJSON object in a
   dedicated `rp-ledger` bucket with object lock (compliance mode, 400 days) and a write-only credential for the
   worker. The restore runbook runs `maintenance.replay-deletions --since <backupTime>`, which re-applies each purge
   (idempotent: delete, then HEAD = 404, then set `filesPurgedAt`). Backups of the private bucket are not taken; object
   storage is the system of record for bytes, so a DB restore cannot resurrect a deleted object, only a stale row.
5. **ipHash 90 days (`PRV-011`):** a retention rule nulls `ipHash` on every table that has one.

## Alternatives considered

| Option | Why not |
|---|---|
| Hard-delete the user row and cascade | Breaks audit, enforcement history and appeal records; cascades through `Restrict` FKs by design |
| Rely on backup retention ≤ proof retention | Couples backup policy to legal retention values that are still OPEN (L-5) |
| Hash-chain the deletion log in MySQL | Lost with the same restore it is meant to repair |

## Consequences

**Positive:** one place lists every retention rule; erasure is observable and resumable; restores are safe.

**Negative / risks:** the semantics (anonymise vs. remove reviews) still depend on Legal (L-4). The ledger bucket
needs an object-lock-capable store (R2 and S3 both support it; MinIO in dev).

## Follow-ups

- Legal: L-4, L-5, L-11 confirmation before launch. DevOps: `rp-ledger` bucket and credential.
