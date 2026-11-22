import type { Clock, ModerationConfig } from "@rp/core";
import type { Breaker } from "@rp/core";
import { runAssess, type AssessJobDeps } from "./assess";

export interface RescanCandidate { caseId: string; contentVersion: number; rescanCount: number }
export interface RescanPort {
  /** HOLD cases whose decisions are all AI_UNAVAILABLE with no HUMAN decision (spec §5.3). */
  heldAiUnavailable(limit: number): Promise<RescanCandidate[]>;
  /** Conditional increment (rescanCount < max); false when another run took it. */
  incrementRescan(caseId: string, max: number): Promise<boolean>;
}
/** `moderation.rescan-failed` every 10 min, only while the breaker is closed (AIF-007, TMR-009: never moves holdExpiresAt). */
export async function runRescanFailed(d: AssessJobDeps & { rescan: RescanPort; breaker: Breaker; clock: Clock; config: ModerationConfig }): Promise<{ scanned: number; applied: number }> {
  if (!d.config.ai.rescanOnRecovery || d.breaker.isOpen()) return { scanned: 0, applied: 0 };
  let scanned = 0, applied = 0;
  for (const c of await d.rescan.heldAiUnavailable(200)) {
    if (c.rescanCount >= d.config.ai.maxRescans || !(await d.rescan.incrementRescan(c.caseId, d.config.ai.maxRescans))) continue;
    scanned++;
    const r = await runAssess(d, c.caseId, c.contentVersion);
    if (r.status === "applied") applied++;
  }
  return { scanned, applied };
}
