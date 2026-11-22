import { QUARANTINE_PREFIX, QUARANTINE_RETENTION_DAYS, type ObjectStore, systemClock } from "@rp/core";

export const QUARANTINE_ALERT_THRESHOLD = 50;

/**
 * SEC-M5-03 / MED-032: infected originals in `rp-private/quarantine/` are purged after 30 days, and a security alert fires
 * when more than a threshold of them is waiting (a burst of malware uploads is itself a signal). The `legal-hold/` prefix
 * is a different prefix and is never swept. Idempotent; paged by the store's list limit.
 */
export async function sweepQuarantine(
  d: { store: ObjectStore; buckets: { private: string }; alert?: (kind: string, detail: Record<string, unknown>) => void },
  now: Date = systemClock.now(),
  opts: { days?: number; threshold?: number; limit?: number } = {},
): Promise<{ deleted: number; remaining: number }> {
  const cutoff = now.getTime() - (opts.days ?? QUARANTINE_RETENTION_DAYS) * 86_400_000;
  const objs = await d.store.list(d.buckets.private, QUARANTINE_PREFIX, opts.limit ?? 1000);
  const expired = objs.filter((o) => o.lastModified.getTime() < cutoff);
  for (const o of expired) await d.store.delete(d.buckets.private, o.key);
  const remaining = objs.length - expired.length;
  if (remaining > (opts.threshold ?? QUARANTINE_ALERT_THRESHOLD)) d.alert?.("QUARANTINE_COUNT_HIGH", { count: remaining });
  return { deleted: expired.length, remaining };
}
