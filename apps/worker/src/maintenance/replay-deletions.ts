import type { Clock, LedgerReader, ObjectStore } from "@rp/core";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ReplayDeps { db: any; store: ObjectStore; reader: LedgerReader; clock: Clock }
export interface ReplayResult { replayed: number; failed: number; keys: number }
const split = (k: string): [string, string] => { const i = k.indexOf("/"); return [k.slice(0, i), k.slice(i + 1)]; };

/**
 * `maintenance.replay-deletions --since YYYY-MM-DD` (OPS-001, ADR-0033 §4): one-shot job started by the restore runbook.
 * Re-applies each ledger purge idempotently: delete, HEAD must be 404, then set the row state again. Never recreates an object.
 */
export async function replayDeletions(d: ReplayDeps, since: string): Promise<ReplayResult> {
  const entries = await d.reader.read(since);
  const res: ReplayResult = { replayed: 0, failed: 0, keys: entries.length };
  const goneByEntity = new Map<string, Map<string, string>>(); // entity -> id -> purgedAt
  const failedIds = new Set<string>();
  for (const e of entries) {
    const [bucket, key] = split(e.objectKey);
    await d.store.delete(bucket, key).catch(() => undefined);
    if ((await d.store.head(bucket, key)) !== null) { failedIds.add(`${e.entity}:${e.id}`); res.failed++; continue; }
    const m = goneByEntity.get(e.entity) ?? new Map(); m.set(e.id, e.purgedAt); goneByEntity.set(e.entity, m);
    res.replayed++;
  }
  const ok = (entity: string) => [...(goneByEntity.get(entity) ?? new Map<string, string>()).entries()].filter(([id]) => !failedIds.has(`${entity}:${id}`));
  const proofIds = new Set<string>();
  for (const [id, at] of ok("PurchaseProofFile")) {
    const f = await d.db.purchaseProofFile.findUnique({ where: { id } });
    if (!f) continue;
    await d.db.purchaseProofFile.updateMany({ where: { id }, data: { status: "PURGED", purgedAt: new Date(at) } });
    proofIds.add(f.proofId);
  }
  for (const proofId of proofIds) {
    const files: any[] = await d.db.purchaseProofFile.findMany({ where: { proofId } });
    const at = d.clock.now();
    const originalsGone = files.filter((f) => !f.isRedacted).every((f) => f.status === "PURGED");
    const allGone = files.every((f) => f.status === "PURGED");
    if (allGone) await d.db.purchaseProof.updateMany({ where: { id: proofId }, data: { filesPurgedAt: at, originalPurgedAt: at } });
    else if (originalsGone) await d.db.purchaseProof.updateMany({ where: { id: proofId }, data: { originalPurgedAt: at } });
  }
  for (const [id] of ok("MediaAsset")) await d.db.mediaAsset.updateMany({ where: { id }, data: { status: "FAILED", failureReason: "ERASED", thumbKey: null, mediumKey: null, videoKey: null, posterKey: null } });
  return res;
}
