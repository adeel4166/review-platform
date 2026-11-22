import { ALGORITHM_VERSION, BASE, BAND_LOW_MAX, BAND_MEDIUM_MAX, COMPONENT_CAP, MATURITY, RECENT_NEGATIVE_DAYS, SELLER_SIGNAL_RULES, USER_COMPONENT_OF, USER_SIGNAL_RULES, type SignalRule, type TrustBand } from "./weights";
import type { Clock } from "../clock";

export interface SignalInput { type: string; value: number; occurredAt: Date; voidedAt?: Date | null }
export interface TrustResult {
  score: number;
  band: TrustBand;
  gates: { ageOk: boolean; emailOk: boolean; actionsOk: boolean };
  caps: ("ACTIVE_RESTRICTION" | "RECENT_NEGATIVE")[];
  components: Record<string, { raw: number; contribution: number; capped: boolean }>;
  algorithmVersion: string;
}
export interface UserInputs {
  createdAt: Date; emailVerified: boolean; twoFactor: boolean; activeRestriction: boolean;
  /** Qualifying actions: published reviews + verified purchases + distinct days with a vote cast. */
  qualifyingActions: number;
  signals: readonly SignalInput[];
}
export interface SellerInputs {
  verified: boolean; verifiedClaimAt: Date | null; replyRate: number; verifiedShare: number;
  suspended: boolean; replyRestricted: boolean; signals: readonly SignalInput[];
}

const DAY = 86_400_000;
/** Half-even rounding to 2 decimals (TRS-005 determinism, ADR-0029). */
export function roundHalfEven(n: number, digits = 2): number {
  const f = 10 ** digits, x = n * f, fl = Math.floor(x), diff = x - fl;
  const eps = 1e-9;
  let r: number;
  if (Math.abs(diff - 0.5) < eps) r = fl % 2 === 0 ? fl : fl + 1;
  else r = Math.round(x);
  return r / f;
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const bandOf = (score: number): Exclude<TrustBand, "NEW"> => (score < BAND_LOW_MAX ? "LOW" : score < BAND_MEDIUM_MAX ? "MEDIUM" : "HIGH");
const rank = (b: TrustBand) => ["NEW", "LOW", "MEDIUM", "HIGH"].indexOf(b);
const minBand = (a: TrustBand, b: TrustBand): TrustBand => (rank(a) <= rank(b) ? a : b);

function signalComponents(rules: Readonly<Record<string, SignalRule>>, groupOf: Readonly<Record<string, string>>, signals: readonly SignalInput[], now: Date) {
  const sums = new Map<string, { raw: number; contribution: number; capped: boolean }>();
  const perType = new Map<string, number>();
  for (const s of signals) {
    const rule = rules[s.type];
    if (!rule || s.voidedAt) continue;
    const ageDays = Math.max(0, (now.getTime() - s.occurredAt.getTime()) / DAY);
    const decay = 0.5 ** (ageDays / rule.halfLifeDays);
    const base = rule.perValue ? rule.value * s.value : s.type === "ENFORCEMENT_ACTION" || s.type === "HELPFUL_VOTE_RECEIVED" ? s.value : rule.value;
    const v = base * decay;
    // per-type cap first, then the joint component cap below
    const typeSum = (perType.get(s.type) ?? 0) + v;
    perType.set(s.type, typeSum);
  }
  for (const [type, raw] of perType) {
    const rule = rules[type]!;
    const capped = rule.cap >= 0 ? Math.min(raw, rule.cap) : Math.max(raw, rule.cap);
    const key = groupOf[type] ?? type;
    const cur = sums.get(key) ?? { raw: 0, contribution: 0, capped: false };
    cur.raw += raw; cur.contribution += capped; cur.capped ||= capped !== raw;
    sums.set(key, cur);
  }
  for (const [key, c] of sums) {
    const joint = COMPONENT_CAP[key];
    if (joint !== undefined && c.contribution < joint) { c.contribution = joint; c.capped = true; }
  }
  return sums;
}

function finish(sum: number, band0: Exclude<TrustBand, "NEW">, gate: { gated: boolean }, caps: TrustResult["caps"], gates: TrustResult["gates"], parts: Map<string, { raw: number; contribution: number; capped: boolean }>, capBand: TrustBand | null): TrustResult {
  const score = roundHalfEven(clamp(sum, 0, 100));
  let band: TrustBand = gate.gated ? "NEW" : band0;
  if (capBand) band = band === "NEW" ? band : minBand(band, capBand);
  const components: TrustResult["components"] = {};
  for (const [k, v] of [...parts].sort(([a], [b]) => a.localeCompare(b))) components[k] = { raw: roundHalfEven(v.raw), contribution: roundHalfEven(v.contribution), capped: v.capped };
  return { score, band, gates, caps, components, algorithmVersion: ALGORITHM_VERSION };
}

/** Pure: same inputs + same clock -> same result (TRS-005). */
export function scoreUser(i: UserInputs, clock: Clock): TrustResult {
  const now = clock.now();
  const ageDays = Math.max(0, (now.getTime() - i.createdAt.getTime()) / DAY);
  const gates = { ageOk: ageDays >= MATURITY.minAgeDays, emailOk: i.emailVerified, actionsOk: i.qualifyingActions >= MATURITY.minActions };
  const parts = signalComponents(USER_SIGNAL_RULES, USER_COMPONENT_OF, i.signals, now);
  parts.set("ACCOUNT_AGE", { raw: 15 * Math.min(ageDays / 90, 1), contribution: 15 * Math.min(ageDays / 90, 1), capped: ageDays >= 90 });
  const sec = (i.emailVerified ? 5 : 0) + (i.twoFactor ? 5 : 0);
  parts.set("ACCOUNT_SECURITY", { raw: sec, contribution: sec, capped: false });
  let sum = BASE;
  for (const c of parts.values()) sum += c.contribution;
  const caps: TrustResult["caps"] = [];
  let capBand: TrustBand | null = null;
  if (i.activeRestriction) { caps.push("ACTIVE_RESTRICTION"); capBand = "LOW"; }
  const cutoff = now.getTime() - RECENT_NEGATIVE_DAYS * DAY;
  const negative = i.signals.some((s) => !s.voidedAt && (USER_SIGNAL_RULES[s.type]?.value ?? 0) < 0 && s.occurredAt.getTime() >= cutoff);
  if (negative) { caps.push("RECENT_NEGATIVE"); capBand = capBand ? minBand(capBand, "MEDIUM") : "MEDIUM"; }
  const clamped = clamp(sum, 0, 100);
  return finish(sum, bandOf(roundHalfEven(clamped)), { gated: !(gates.ageOk && gates.emailOk && gates.actionsOk) }, caps, gates, parts, capBand);
}

/** Seller score: no NEW gate; an unverified seller is LOW at most. */
export function scoreSeller(i: SellerInputs, clock: Clock): TrustResult {
  const now = clock.now();
  const parts = signalComponents(SELLER_SIGNAL_RULES, {}, i.signals, now);
  const months = i.verifiedClaimAt ? Math.max(0, (now.getTime() - i.verifiedClaimAt.getTime()) / (30 * DAY)) : 0;
  const add = (k: string, v: number) => parts.set(k, { raw: v, contribution: v, capped: false });
  add("VERIFIED", i.verified ? 20 : 0);
  add("CLAIM_AGE", i.verified ? 10 * Math.min(months / 12, 1) : 0);
  add("REPLY_RATE", 15 * clamp(i.replyRate, 0, 1));
  add("VERIFIED_SHARE", 15 * clamp(i.verifiedShare, 0, 1));
  if (i.suspended) add("SUSPENSION", -40);
  if (i.replyRestricted) add("REPLY_RESTRICTION", -15);
  let sum = BASE;
  for (const c of parts.values()) sum += c.contribution;
  const gates = { ageOk: true, emailOk: true, actionsOk: true };
  return finish(sum, bandOf(roundHalfEven(clamp(sum, 0, 100))), { gated: false }, [], gates, parts, i.verified ? null : "LOW");
}

/** Plain-language explanation: component names and direction only, never numbers (ADR-0029 §4). */
export function publicExplanation(r: Pick<TrustResult, "components" | "gates">): { positive: string[]; negative: string[]; maturity: string[] } {
  const positive: string[] = [], negative: string[] = [], maturity: string[] = [];
  for (const [k, c] of Object.entries(r.components)) (c.contribution > 0 ? positive : c.contribution < 0 ? negative : []).push(k);
  if (!r.gates.ageOk) maturity.push("ACCOUNT_AGE");
  if (!r.gates.emailOk) maturity.push("EMAIL_VERIFIED");
  if (!r.gates.actionsOk) maturity.push("ACTIONS");
  return { positive, negative, maturity };
}
