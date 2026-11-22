/** `staff.anomaly-scan` (hourly, SEC-012, P-4): flags, never sanctions. */
export interface ModeratorStats { moderatorId: string; removalsBySeller: Record<string, number>; decisions: number; disagreeingWithAi: number; bulkOperations: number }
export interface AnomalyConfig { removalsPerSellerPerDay: number; disagreementRatio: number; minDecisions: number; bulkPerDay: number }
export const DEFAULT_ANOMALY: AnomalyConfig = { removalsPerSellerPerDay: 10, disagreementRatio: 0.3, minDecisions: 50, bulkPerDay: 5 };
export interface Anomaly { moderatorId: string; kind: "removals_concentrated" | "ai_disagreement" | "bulk_volume"; detail: Record<string, number | string> }

export function scanStaffAnomalies(stats: readonly ModeratorStats[], cfg: AnomalyConfig = DEFAULT_ANOMALY): Anomaly[] {
  const out: Anomaly[] = [];
  for (const s of stats) {
    for (const [sellerId, n] of Object.entries(s.removalsBySeller)) if (n > cfg.removalsPerSellerPerDay) out.push({ moderatorId: s.moderatorId, kind: "removals_concentrated", detail: { sellerId, count: n } });
    if (s.decisions >= cfg.minDecisions && s.disagreeingWithAi / s.decisions > cfg.disagreementRatio) out.push({ moderatorId: s.moderatorId, kind: "ai_disagreement", detail: { decisions: s.decisions, disagreeing: s.disagreeingWithAi } });
    if (s.bulkOperations > cfg.bulkPerDay) out.push({ moderatorId: s.moderatorId, kind: "bulk_volume", detail: { count: s.bulkOperations } });
  }
  return out;
}
