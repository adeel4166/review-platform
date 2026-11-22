import { addMs, type Clock } from "./clock";

/** ADR-0027 / spec §9: break-glass access to an original proof file. Pure rules; persistence + streaming in apps/web. */
export const BREAK_GLASS_TTL_MS = 60_000;
export const DAILY_CAP = 20;
export const DAILY_ALERT_AT = 10;
export const STEP_UP_MAX_AGE_MS = 10 * 60_000;
export const REPEAT_WINDOW_MS = 7 * 24 * 3_600_000;
export const REASON_MIN = 20;
export const REASON_MAX = 500;

export class BreakGlassError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 410 | 429, public code: "reason_invalid" | "step_up_required" | "forbidden" | "original_purged" | "break_glass_cap" | "access_expired" | "access_used" | "not_found" | "conflict_of_interest") { super(code); }
}
export type BreakGlassDecision = { kind: "grant"; expiresAt: Date; alert: boolean } | { kind: "needs_approval" };

export function decideBreakGlass(i: {
  clock: Clock; reasonText: string; stepUpAt: number | null; originalExists: boolean; staffId: string; submitterId: string; staffIsSubmitter?: boolean;
  accessesToday: number; recentSameSubmitter: number;
}): BreakGlassDecision {
  const now = i.clock.now();
  const len = [...i.reasonText.trim()].length;
  if (len < REASON_MIN || len > REASON_MAX) throw new BreakGlassError(400, "reason_invalid");
  if (i.staffIsSubmitter || i.staffId === i.submitterId) throw new BreakGlassError(403, "conflict_of_interest");
  if (i.stepUpAt === null || now.getTime() - i.stepUpAt > STEP_UP_MAX_AGE_MS) throw new BreakGlassError(401, "step_up_required");
  if (!i.originalExists) throw new BreakGlassError(410, "original_purged");
  if (i.accessesToday >= DAILY_CAP) throw new BreakGlassError(429, "break_glass_cap"); // the 21st
  if (i.recentSameSubmitter > 0) return { kind: "needs_approval" }; // BREAK_GLASS_REPEAT within 7 d
  return { kind: "grant", expiresAt: addMs(now, BREAK_GLASS_TTL_MS), alert: i.accessesToday + 1 >= DAILY_ALERT_AT };
}

/** Single use, session bound, 60 s (BGL-001). `usedAt` is set by a conditional update; this checks the pre-conditions. */
export function assertAccessUsable(a: { staffId: string; sessionId: string; expiresAt: Date; usedAt: Date | null }, who: { staffId: string; sessionId: string }, clock: Clock): void {
  if (a.staffId !== who.staffId || a.sessionId !== who.sessionId) throw new BreakGlassError(404, "not_found");
  if (a.usedAt) throw new BreakGlassError(409, "access_used");
  if (clock.now().getTime() >= a.expiresAt.getTime()) throw new BreakGlassError(410, "access_expired");
}
export const BREAK_GLASS_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Content-Disposition": "inline",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
