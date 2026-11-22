# Runbook: database restore and re-delete (OPS-001)

**Why.** Object storage is the system of record for bytes and is not restored with the database. A database restore brings back rows from before a purge
(`filesPurgedAt = NULL`, proofs and media looking live) while the objects are already gone. The deletion ledger (ADR-0033 §4) lets us re-apply every purge
so nothing is resurrected. Spec: `docs/architecture/m6-m8-spec.md` §22.3.

**Ledger.** Every verified purge (proof files, media, erasure) appends `{objectKey, entity, id, purgedAt}` NDJSON segments to the `rp-ledger` bucket
(`YYYY-MM-DD/<uuid>.ndjson`, object lock, worker holds a write-only credential). The restore operator uses the separate read credential (`S3_LEDGER_READ_*`).

## Steps

1. Stop web and worker (no new purges or uploads during the restore).
2. Restore the MySQL dump. Note the **backup time** (UTC date `YYYY-MM-DD` of the dump).
3. Start only the core worker with `S3_BUCKET_LEDGER`, `S3_LEDGER_READ_ACCESS_KEY_ID` and `S3_LEDGER_READ_SECRET_ACCESS_KEY` set.
4. Enqueue the one-shot job on the `maintenance` queue: `maintenance.replay-deletions` with `{ "since": "<backup date>" }`
   (use the backup date minus one day when unsure; replay is idempotent).
5. Read the job log line `m8.job.done`. `failed` must be 0. A non-zero `failed` means an object could not be verified as deleted: investigate storage, then rerun.
6. Verify: pick three purged proofs from the ledger, `HEAD` each key (must be 404) and check `purchase_proofs.filesPurgedAt IS NOT NULL`.
7. Start web and the remaining workers. Run `maintenance.retention` once so time-based rules catch up.
8. Account erasures: for each `erasure_requests` row restored with `completedAt IS NULL`, the `account.erase` job resumes from the recorded steps. Users erased
   after the backup are **not** in the dump: re-run the erasure from the support record (`DELETE /api/account` equivalent) before reopening signups.

## What replay does / does not do

- Deletes each ledger key, requires `HEAD` = 404, then sets `PurchaseProofFile.status = PURGED`, `purgedAt`, and the proof's `originalPurgedAt` / `filesPurgedAt`.
- Never creates objects. Never touches rows whose key could not be verified.
- Tested by `apps/worker/src/maintenance/replay-deletions.int.test.ts`.
