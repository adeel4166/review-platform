/** ADR-0025 §3: the automation actor is a closed allow-list (AZ-017). Everything else is denied. */
export type SystemAction =
  | { kind: "decision.write" }
  | { kind: "enforcement.issue"; type: string; reasonCode?: string; zeroToleranceVerdict?: boolean }
  | { kind: string };

const ALWAYS = new Set(["decision.write", "audit.write", "outbox.write", "trust.signal"]);
const ENFORCEMENT_OK = new Set(["WARNING", "CONTENT_REMOVAL", "POSTING_RESTRICTION"]);

export function authorizeSystem(action: SystemAction): boolean {
  if (ALWAYS.has(action.kind)) return true;
  if (action.kind !== "enforcement.issue") return false; // role.*, config.*, anything unknown
  const a = action as { type: string; reasonCode?: string; zeroToleranceVerdict?: boolean };
  if (ENFORCEMENT_OK.has(a.type)) return a.type !== "POSTING_RESTRICTION" || (a.reasonCode ?? "").startsWith("STRIKE_LADDER_");
  // The single exception: protective SUSPENSION with a zero-tolerance verdict.
  return a.type === "SUSPENSION" && a.reasonCode === "ZERO_TOLERANCE_HOLD" && a.zeroToleranceVerdict === true;
}
export function assertSystem(action: SystemAction): void {
  if (!authorizeSystem(action)) throw new Error(`system_principal_denied:${action.kind}`);
}
