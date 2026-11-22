import { addDays } from "../clock";
import type { ModerationConfig } from "./config";

export type StrikeTiming = "NOW" | "WINDOW_CLOSE" | "NEVER";
const HUMAN_REMOVE = new Set(["T6", "T9", "T17", "T21", "R6"]);
const AI_VIOLATION = new Set(["T3", "T4v", "R3"]);

/** Pipeline §9 / spec §7.2: when (if ever) a decision becomes a strike. */
export function strikeTiming(d: { transition: string; resolutionCode?: string | null; overturned?: boolean; authorDeleted?: boolean; fixedByResubmit?: boolean }): StrikeTiming {
  if (d.overturned || d.authorDeleted === true && !AI_VIOLATION.has(d.transition)) return "NEVER";
  if (d.resolutionCode === "HOLD_EXPIRED" || d.resolutionCode === "POST_REVIEW_LAPSED") return "NEVER";
  if (HUMAN_REMOVE.has(d.transition)) return "NOW";
  if (AI_VIOLATION.has(d.transition)) return d.fixedByResubmit ? "NEVER" : "WINDOW_CLOSE"; // MOD-008
  return "NEVER";
}

export interface StrikeRow { startsAt: Date; status: "ACTIVE" | "EXPIRED" | "OVERTURNED" | "REVOKED" }
/** Strikes in the rolling window; overturned ones do not count (MOD-013). */
export const countStrikes = (rows: readonly StrikeRow[], now: Date, windowDays = 180): number =>
  rows.filter((r) => (r.status === "ACTIVE" || r.status === "EXPIRED") && r.startsAt.getTime() > addDays(now, -windowDays).getTime() && r.startsAt.getTime() <= now.getTime()).length;

export interface LadderAction { type: "WARNING" | "POSTING_RESTRICTION"; reasonCode: string; days: number | null; escalate: boolean }
/** The configured ladder; the actions are issued by the system principal (AZ-017). 5+ is an indefinite restriction plus escalation. */
export function ladderFor(count: number, cfg?: ModerationConfig): LadderAction | null {
  if (count < 1) return null;
  const reasonCode = `STRIKE_LADDER_${Math.min(count, 5)}`;
  void cfg;
  if (count <= 2) return { type: "WARNING", reasonCode, days: null, escalate: false };
  if (count === 3) return { type: "POSTING_RESTRICTION", reasonCode, days: 7, escalate: false };
  if (count === 4) return { type: "POSTING_RESTRICTION", reasonCode, days: 30, escalate: false };
  return { type: "POSTING_RESTRICTION", reasonCode, days: null, escalate: true };
}
