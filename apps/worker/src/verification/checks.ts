import { CHALLENGE_PREFIX, DAY_MS, applyClaimTransition, decideReverify, dnsChallengeHost, evaluateObservedTokens, isRecheckDue, decideValidity, WORKER_CHECKED_METHODS, CLAIM_CONFIG, type CheckOutcome, type ClaimDb } from "@rp/core";
import { extractMetaTokens } from "./meta";
import type { FetchError, FetchResult } from "./safe-fetch";

export interface CheckDeps {
  fetcher: { fetch(url: string, o?: { finalMustBeInside?: string }): Promise<FetchResult> };
  dns: { resolveTxt(host: string): Promise<string[][]> };
}
export interface ObservedResult { observed: string[]; error: CheckOutcome | null }

const mapFetchError = (e: FetchError): CheckOutcome => (e.startsWith("BLOCKED") || e === "REDIRECT_OFF_DOMAIN" ? "FETCH_BLOCKED" : e === "DNS_FAILURE" ? "DNS_ERROR" : "FETCH_ERROR");

/** DNS_TXT: TXT at `_rp-verify.<domain>`, strings of one record concatenated (RFC 7208 §3.3), at most 20 records read. */
export async function observeDns(d: CheckDeps, domain: string): Promise<ObservedResult> {
  try {
    const recs = (await d.dns.resolveTxt(dnsChallengeHost(domain))).slice(0, 20).map((r) => r.join(""));
    return { observed: recs.filter((r) => r.startsWith(CHALLENGE_PREFIX)).map((r) => r.slice(CHALLENGE_PREFIX.length)).slice(0, 5), error: null };
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? { observed: [], error: null } : { observed: [], error: "DNS_ERROR" };
  }
}

/** META_TAG: https://<domain>/ then https://www.<domain>/ through the SSRF-safe fetcher. The URL is built by the server. */
export async function observeMeta(d: CheckDeps, domain: string): Promise<ObservedResult> {
  let error: CheckOutcome | null = null;
  for (const url of [`https://${domain}/`, `https://www.${domain}/`]) {
    const r = await d.fetcher.fetch(url, { finalMustBeInside: domain });
    if (!r.ok) { error = mapFetchError(r.error); continue; }
    const observed = extractMetaTokens(r.body.toString("utf8"));
    if (observed.length) return { observed, error: null };
    error = null;
  }
  return { observed: [], error };
}

export async function observe(d: CheckDeps, method: string, domain: string): Promise<ObservedResult> {
  return method === "DNS_TXT" ? observeDns(d, domain) : observeMeta(d, domain);
}

interface ClaimRow {
  id: string; status: string; method: string; domain: string | null; challengeValue: string | null; challengeExpiresAt: Date | null;
  verifiedUntil: Date | null; lastCheckAt: Date | null; graceEndsAt: Date | null; lastCheckOutcome: CheckOutcome | null;
}
export interface CheckStore extends ClaimDb {
  sellerOwnershipClaim: { findUnique(a: unknown): Promise<ClaimRow | null>; findMany(a: unknown): Promise<ClaimRow[]> };
}
const SYSTEM = { id: null, type: "SYSTEM" } as const;
const FOREVER = new Date(8.64e15);

/**
 * `verification.check` {claimId}: runs the DNS/META check for a PENDING claim (C2-C5) or a VERIFIED claim's re-verification
 * (C13/C14/C15). Egress errors never end a claim; they only record the outcome and back off.
 */
export async function processClaimCheck(db: CheckStore, d: CheckDeps, claimId: string, now: Date = new Date()): Promise<string> {
  const c = await db.sellerOwnershipClaim.findUnique({ where: { id: claimId } });
  if (!c || !c.domain || !WORKER_CHECKED_METHODS.includes(c.method as never)) return "SKIPPED";
  if (c.status !== "PENDING" && c.status !== "VERIFIED") return "SKIPPED";
  const obs = await observe(d, c.method, c.domain);
  if (c.status === "PENDING") {
    const outcome = obs.error ?? evaluateObservedTokens(c, obs.observed, now);
    if (outcome === "PASS") {
      const r = await applyClaimTransition(db, claimId, { action: "CHECK_PASSED", observed: obs.observed }, SYSTEM, now);
      return `PASS:${r.status}`;
    }
    await applyClaimTransition(db, claimId, { action: "CHECK_FAILED", outcome }, SYSTEM, now);
    return outcome;
  }
  // VERIFIED: the token must still be there (the original 72 h challenge expiry does not apply to re-checks)
  const outcome = obs.error ?? evaluateObservedTokens({ challengeValue: c.challengeValue, challengeExpiresAt: FOREVER }, obs.observed, now);
  const decision = decideReverify(c as never, outcome, now);
  if (decision === "RENEW") await applyClaimTransition(db, claimId, { action: "REVERIFY_PASSED" }, SYSTEM, now);
  else if (decision === "ENTER_GRACE") await applyClaimTransition(db, claimId, { action: "ENTER_GRACE", outcome }, SYSTEM, now);
  else if (decision === "EXPIRE_GRACE") {
    await applyClaimTransition(db, claimId, { action: "ENTER_GRACE", outcome }, SYSTEM, now); // record the latest outcome first
    await applyClaimTransition(db, claimId, { action: "EXPIRE_GRACE" }, SYSTEM, now);
  } else await applyClaimTransition(db, claimId, { action: "ENTER_GRACE", outcome }, SYSTEM, now);
  return `${decision}:${outcome}`;
}

// -- Sweepers (maintenance.claims-*) ----------------------------------------------------------------------------------

export interface SweepStore extends CheckStore {
  sellerOwnershipClaim: CheckStore["sellerOwnershipClaim"];
}
export interface JobEnqueuer { add(name: string, data: unknown, opts: { jobId: string }): Promise<unknown> }

/** claims-due-checks (1 min) + claims-reverify (daily): enqueue DNS/META checks. Deterministic job ids dedupe repeats. */
export async function sweepDueChecks(db: SweepStore, q: JobEnqueuer, now: Date = new Date()): Promise<number> {
  const pending = await db.sellerOwnershipClaim.findMany({ where: { status: "PENDING", method: { in: [...WORKER_CHECKED_METHODS] }, nextCheckAt: { lte: now } }, take: 200 });
  const verified = (await db.sellerOwnershipClaim.findMany({ where: { status: "VERIFIED", method: { in: [...WORKER_CHECKED_METHODS] } }, take: 500 })).filter((c) => isRecheckDue(c as never, now));
  let n = 0;
  for (const c of pending) { await q.add("verification.check", { claimId: c.id }, { jobId: `claimcheck__${c.id}__${c.lastCheckAt?.getTime() ?? 0}` }); n++; }
  for (const c of verified) { await q.add("verification.check", { claimId: c.id }, { jobId: `claimreverify__${c.id}__${Math.floor(now.getTime() / (c.graceEndsAt ? 24 * 3_600_000 : DAY_MS))}` }); n++; }
  return n;
}

/** claims-expire (15 min): challenge / info timeouts. Each call is a guarded, idempotent transition. */
export async function sweepExpiry(db: SweepStore, now: Date = new Date()): Promise<number> {
  const pending = await db.sellerOwnershipClaim.findMany({ where: { status: "PENDING" }, take: 500 });
  let n = 0;
  for (const c of pending) {
    for (const action of ["EXPIRE_CHALLENGE", "EXPIRE_INFO"] as const) {
      const r = await applyClaimTransition(db, c.id, { action }, SYSTEM, now);
      if (r.changed) { n++; break; }
    }
  }
  return n;
}

/** claims-grace (hourly) + claims-validity (daily): start grace for lapsed EMAIL/DOCUMENT/MARKETPLACE validity, expire lapsed grace (downgrade). */
export async function sweepGrace(db: SweepStore, now: Date = new Date()): Promise<{ graceStarted: number; expired: number }> {
  const verified = await db.sellerOwnershipClaim.findMany({ where: { status: "VERIFIED" }, take: 1000 });
  let graceStarted = 0;
  let expired = 0;
  for (const c of verified) {
    const d = decideValidity(c as never, now);
    if (d === "ENTER_GRACE") { if ((await applyClaimTransition(db, c.id, { action: "ENTER_GRACE" }, SYSTEM, now)).changed) graceStarted++; }
    else if (d === "EXPIRE_GRACE") { if ((await applyClaimTransition(db, c.id, { action: "EXPIRE_GRACE" }, SYSTEM, now)).changed) expired++; }
  }
  return { graceStarted, expired };
}
export { CLAIM_CONFIG };
