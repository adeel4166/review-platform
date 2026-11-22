import type { Clock } from "../clock";
import type { ObjectStore } from "../media";

/** ADR-0033 §4: every verified purge appends `{objectKey, entity, id, purgedAt}` to the deletion ledger (separate bucket, object lock). */
export interface LedgerEntry { objectKey: string; entity: string; id: string; purgedAt: string }
export interface LedgerWriter { append(entries: LedgerEntry[]): Promise<void> }
export interface LedgerReader { read(sinceDay: string): Promise<LedgerEntry[]> }

const day = (d: Date) => d.toISOString().slice(0, 10);
/** Write-only credential friendly: each flush is a new immutable segment `YYYY-MM-DD/<seq>.ndjson` (no read-modify-write). */
export const ledgerKey = (d: Date, segment: string) => `${day(d)}/${segment}.ndjson`;
export const toNdjson = (e: readonly LedgerEntry[]): string => e.map((x) => JSON.stringify(x)).join("\n") + "\n";
export function parseNdjson(text: string): LedgerEntry[] {
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry);
}

export function createLedgerWriter(store: ObjectStore, bucket: string, clock: Clock, newSegment: () => string): LedgerWriter {
  return {
    async append(entries) {
      if (!entries.length) return;
      await store.put(bucket, ledgerKey(clock.now(), newSegment()), Buffer.from(toNdjson(entries)), "application/x-ndjson");
    },
  };
}
/** Reader (restore runbook credential): lists segments from `since` (YYYY-MM-DD, inclusive) and parses them. */
export function createLedgerReader(store: ObjectStore, bucket: string): LedgerReader {
  return {
    async read(since) {
      const keys = (await store.list(bucket, "", 10_000)).map((o) => o.key).filter((k) => k.slice(0, 10) >= since).sort();
      const out: LedgerEntry[] = [];
      for (const k of keys) { const b = await store.get(bucket, k, 16 * 1024 * 1024); if (b) out.push(...parseNdjson(b.toString("utf8"))); }
      return out;
    },
  };
}
