import { systemClock, type Clock } from "../clock";
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
/** Per-day listing ceiling. Reaching it means the listing may be truncated, which fails the job (SEC-FIN-03) instead of silently dropping segments. */
export const LEDGER_DAY_LIST_LIMIT = 1_000_000;
export class LedgerListingTruncatedError extends Error {
  constructor(public day: string) { super(`ledger listing truncated for ${day}`); }
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Every `YYYY-MM-DD` (UTC) from `since` to `today`, inclusive. */
export function ledgerDays(since: string, today: Date): string[] {
  if (!DAY.test(since) || Number.isNaN(Date.parse(since))) throw new Error("ledger since must be YYYY-MM-DD");
  const end = day(today), out: string[] = [];
  for (let d = new Date(`${since}T00:00:00Z`); day(d) <= end; d = new Date(d.getTime() + 86_400_000)) out.push(day(d));
  return out;
}
/**
 * Reader (restore runbook credential): for each day from `since` (inclusive) to today it lists the `YYYY-MM-DD/` prefix (S3 listing is
 * lexicographic, so a whole-bucket list would drop the newest days), paginates without a global cap, and throws if a day's listing hits the ceiling.
 */
export function createLedgerReader(store: ObjectStore, bucket: string, clock: Clock = systemClock, dayLimit = LEDGER_DAY_LIST_LIMIT): LedgerReader {
  return {
    async read(since) {
      const out: LedgerEntry[] = [];
      for (const d of ledgerDays(since, clock.now())) {
        const listed = await store.list(bucket, `${d}/`, dayLimit);
        if (listed.length >= dayLimit) throw new LedgerListingTruncatedError(d);
        for (const k of listed.map((o) => o.key).sort()) { const b = await store.get(bucket, k, 16 * 1024 * 1024); if (b) out.push(...parseNdjson(b.toString("utf8"))); }
      }
      return out;
    },
  };
}
