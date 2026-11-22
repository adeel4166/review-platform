import { createHash } from "node:crypto";
import type { Clock, ObjectStore } from "@rp/core";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** OPS-007 / RET-AUDIT (P-6): export old audit rows to the object-locked `rp-audit-archive`, verify, then delete with a separate archive DB role. */
export interface AuditExportDeps { db: any; /** Separate DB role allowed to DELETE audit rows (the app role cannot). */ archiveDb: any; store: ObjectStore; bucket: string; clock: Clock }
export interface Manifest { day: string; segments: { key: string; sha256: string; count: number; firstId: string; lastId: string }[]; manifestHash: string; prevHash: string | null }

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const day = (d: Date) => d.toISOString().slice(0, 10);
export const manifestKey = (d: string) => `audit/${d}/manifest.json`;
const chain = (prev: string | null, segs: Manifest["segments"]) => sha(`${prev ?? ""}|${segs.map((s) => `${s.key}:${s.sha256}:${s.count}`).join(",")}`);

/** Archives the given audit row ids as one segment. Rows are deleted only after the segment reads back with the same hash and the manifest is written. */
export async function archiveAuditRows(d: AuditExportDeps, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows: any[] = (await d.db.auditLog.findMany({ where: { id: { in: ids } } })).sort((a: any, b: any) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  if (!rows.length) return 0;
  const today = day(d.clock.now());
  const body = Buffer.from(rows.map((r) => JSON.stringify({ ...r, id: String(r.id), createdAt: new Date(r.createdAt).toISOString() })).join("\n") + "\n");
  const first = String(rows[0].id), last = String(rows[rows.length - 1].id);
  const key = `audit/${today}/${first}-${last}.ndjson`;
  await d.store.put(d.bucket, key, body, "application/x-ndjson");
  const back = await d.store.get(d.bucket, key, 256 * 1024 * 1024);
  if (!back || sha(back) !== sha(body)) throw new Error("audit export verification failed"); // rows stay
  const prevRaw = await d.store.get(d.bucket, manifestKey(today), 5 * 1024 * 1024);
  const prev: Manifest | null = prevRaw ? JSON.parse(prevRaw.toString("utf8")) : null;
  const segments = [...(prev?.segments.filter((s) => s.key !== key) ?? []), { key, sha256: sha(body), count: rows.length, firstId: first, lastId: last }];
  const m: Manifest = { day: today, segments, prevHash: prev?.prevHash ?? null, manifestHash: chain(prev?.prevHash ?? null, segments) };
  await d.store.put(d.bucket, manifestKey(today), Buffer.from(JSON.stringify(m)), "application/json");
  await d.archiveDb.auditLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.length;
}
