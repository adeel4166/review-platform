import { CHALLENGE_PREFIX, DAY_MS, DomainNotAllowedError, assertHasMx, applyClaimTransition, decideReverify, dnsChallengeHost, evaluateObservedTokens, isRecheckDue, decideValidity, WORKER_CHECKED_METHODS, CLAIM_CONFIG, type CheckOutcome, type ClaimDb, systemClock } from "@rp/core";
import { extractMetaTokens } from "./meta";
import type { FetchError, FetchResult } from "./safe-fetch";

export interface CheckDeps {
  fetcher: { fetch(url: string, o?: { finalMustBeInside?: string }): Promise<FetchResult> };
  dns: { resolveTxt(host: string): Promise<string[][]>; resolveMx?(host: string): Promise<Array<{ exchange: string; priority?: number }>> };
}
export interface ObservedResult { observed: string[]; error: CheckOutcome | null; proofHost?: string }

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

/**
 * META_TAG: https://<domain>/ only, through the SSRF-safe fetcher (T-03: no `www` fallback, a dangling www host must not prove
 * the apex; a site that exists only on www uses DNS_TXT). The URL is built by the server. `proofHost` is the host that served it.
 */
export async function observeMeta(d: CheckDeps, domain: string): Promise<ObservedResult> {
  const r = await d.fetcher.fetch(`https://${domain}/`, { finalMustBeInside: domain });
  if (!r.ok) return { observed: [], error: mapFetchError(r.error) };
  return { observed: extractMetaTokens(r.body.toString("utf8")), error: null, proofHost: domain };
}

/**
 * BUSINESS_EMAIL_DOMAIN (SEL-035): MX records of the claimed domain, at most 20, as "<pref> <exchange>". Only this isolated egress group
 * resolves attacker-chosen names. NXDOMAIN/no data = no MX (empty list); any other resolver failure = DNS_ERROR (core backs off).
 */
export async function observeMx(d: CheckDeps, domain: string): Promise<ObservedResult> {
  if (!d.dns.resolveMx) return { observed: [], error: "DNS_ERROR" };
  try {
    const recs = (await d.dns.resolveMx(domain)).slice(0, 20);
    return { observed: recs.map((r) => `${r.priority ?? 0} ${r.exchange}`), error: null };
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? { observed: [], error: null } : { observed: [], error: "DNS_ERROR" };
  }
}

export async function observe(d: CheckDeps, method: string, domain: string): Promise<ObservedResult> {
  if (method === "BUSINESS_EMAIL_DOMAIN") return observeMx(d, domain);
  return method === "DNS_TXT" ? observeDns(d, domain) : observeMeta(d, domain);
}

interface ClaimRow {
  id: string; status: string; method: string; domain: string | null; challengeValue: string | null; challengeExpiresAt: Date | null;
  verifiedUntil: Date | null; lastCheckAt: Date | null; graceEndsAt: Date | null; lastCheckOutcome: CheckOutcome | null; nextCheckAt?: Date | null;
}
export interface CheckStore extends ClaimDb {
  sellerOwnershipClaim: { findUnique(a: unknown): Promise<ClaimRow | null>; findMany(a: unknown): Promise<ClaimRow[]> };
}
const SYSTEM = { id: null, type: "SYSTEM" } as const;
const FOREVER = new Date(8.64e15);

/** Job sent core -> egress worker (queue `verification-egress`). Everything the isolated worker needs; no DB access there. */
export interface EgressRequest { claimId: string; method: string; domain: string }
/** Job sent egress worker -> core (queue `verification-result`): the raw observation, never a decision. */
export interface EgressResult { claimId: string; observed: string[]; error: CheckOutcome | null; proofHost?: string }

const DOMAIN_RE = /^[a-z0-9.-]{1,253}$/i;

/** Core side, step 1: decide whether a claim needs an egress check and build the request (no network here). */
export async function prepareClaimCheck(db: CheckStore, claimId: string): Promise<EgressRequest | null> {
  const c = await db.sellerOwnershipClaim.findUnique({ where: { id: claimId } });
  if (!c || !c.domain) return null;
  // BUSINESS_EMAIL_DOMAIN: one MX check while PENDING; nextCheckAt is cleared once it passed (no repeat, no re-verification).
  if (c.method === "BUSINESS_EMAIL_DOMAIN") return c.status === "PENDING" && c.nextCheckAt ? { claimId, method: c.method, domain: c.domain } : null;
  if (!WORKER_CHECKED_METHODS.includes(c.method as never)) return null;
  if (c.status !== "PENDING" && c.status !== "VERIFIED") return null;
  return { claimId, method: c.method, domain: c.domain };
}

/** Egress side: the only code that touches the network. Validates the request shape (defence in depth) and observes. */
export async function runEgressCheck(d: CheckDeps, req: EgressRequest): Promise<EgressResult> {
  if (!req || typeof req.claimId !== "string" || !["DNS_TXT", "META_TAG", "BUSINESS_EMAIL_DOMAIN"].includes(req.method) || typeof req.domain !== "string" || !DOMAIN_RE.test(req.domain)) {
    return { claimId: String(req?.claimId ?? ""), observed: [], error: "FETCH_BLOCKED" };
  }
  const obs = await observe(d, req.method, req.domain);
  return { claimId: req.claimId, observed: obs.observed, error: obs.error, ...(obs.proofHost ? { proofHost: obs.proofHost } : {}) };
}

/**
 * Core side, step 2: apply an observation returned by the egress worker to a PENDING claim (C2-C5) or a VERIFIED claim's
 * re-verification (C13/C14/C15). Egress errors never end a claim; they only record the outcome and back off.
 */
export async function applyClaimObservation(db: CheckStore, claimId: string, obs: ObservedResult, now: Date = systemClock.now()): Promise<string> {
  const c = await db.sellerOwnershipClaim.findUnique({ where: { id: claimId } });
  if (c?.method === "BUSINESS_EMAIL_DOMAIN") return applyMxObservation(db, c, obs, now);
  if (!c || !c.domain || !WORKER_CHECKED_METHODS.includes(c.method as never)) return "SKIPPED";
  if (c.status !== "PENDING" && c.status !== "VERIFIED") return "SKIPPED";
  if (c.status === "PENDING") {
    const outcome = obs.error ?? evaluateObservedTokens(c, obs.observed, now);
    if (outcome === "PASS") {
      const r = await applyClaimTransition(db, claimId, { action: "CHECK_PASSED", observed: obs.observed, proofHost: obs.proofHost ?? (c.method === "DNS_TXT" ? dnsChallengeHost(c.domain) : c.domain) }, SYSTEM, now);
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

/**
 * Core side for BUSINESS_EMAIL_DOMAIN (m3b-spec 4.3). No usable MX (none, or only the RFC 7505 null MX) -> REJECTED by RULE `no_mx`.
 * DNS error -> back-off (CHECK_FAILED); the claim expires at its challenge deadline. MX present -> C22: stop re-checking and request
 * the token mail exactly once (the conditional update is the guard against duplicate or retried results).
 */
async function applyMxObservation(db: CheckStore, c: ClaimRow, obs: ObservedResult, now: Date): Promise<string> {
  if (c.status !== "PENDING" || !c.nextCheckAt) return "SKIPPED";
  if (obs.error) {
    await applyClaimTransition(db, c.id, { action: "CHECK_FAILED", outcome: obs.error }, SYSTEM, now);
    return obs.error;
  }
  try {
    await assertHasMx(c.domain!, async () => obs.observed.map((o) => ({ exchange: o.split(" ").slice(1).join(" ") })));
  } catch (e) {
    if (!(e instanceof DomainNotAllowedError)) throw e;
    await applyClaimTransition(db, c.id, { action: "RULE_REJECT", reasonCode: "no_mx" }, SYSTEM, now);
    return "REJECTED:no_mx";
  }
  return (db as unknown as { $transaction<T>(fn: (tx: MxTx) => Promise<T>): Promise<T> }).$transaction(async (tx) => {
    const won = await tx.sellerOwnershipClaim.updateMany({ where: { id: c.id, status: "PENDING", nextCheckAt: { not: null } }, data: { nextCheckAt: null, lastCheckAt: now } });
    if (won.count !== 1) return "SKIPPED";
    const tok = await tx.emailVerificationToken.findFirst({ where: { claimId: c.id, purpose: "CLAIM_BUSINESS_EMAIL", consumedAt: null, invalidatedAt: null } });
    if (!tok) return "SKIPPED";
    await tx.outboxEvent.create({ data: { type: "claim.business_email_token_requested", aggregateId: c.id, payload: { claimId: c.id, tokenId: tok.id } } });
    await tx.auditLog.create({ data: { actorType: "SYSTEM", actorId: null, action: "claim.mx_checked", entityType: "SellerOwnershipClaim", entityId: c.id, metadata: { claimId: c.id, outcome: "PASS" } } });
    return "MX_PASS";
  });
}
interface MxTx {
  sellerOwnershipClaim: { updateMany(a: unknown): Promise<{ count: number }> };
  emailVerificationToken: { findFirst(a: unknown): Promise<{ id: string } | null> };
  outboxEvent: { create(a: unknown): Promise<unknown> };
  auditLog: { create(a: unknown): Promise<unknown> };
}

/** Single-process composition of the three steps (used by tests; production splits it across the two worker groups). */
export async function processClaimCheck(db: CheckStore, d: CheckDeps, claimId: string, now: Date = systemClock.now()): Promise<string> {
  const req = await prepareClaimCheck(db, claimId);
  if (!req) return "SKIPPED";
  return applyClaimObservation(db, claimId, await runEgressCheck(d, req), now);
}

// -- Sweepers (maintenance.claims-*) ----------------------------------------------------------------------------------

export interface SweepStore extends CheckStore {
  sellerOwnershipClaim: CheckStore["sellerOwnershipClaim"];
}
export interface JobEnqueuer { add(name: string, data: unknown, opts: { jobId: string }): Promise<unknown> }

/** claims-due-checks (1 min) + claims-reverify (daily): enqueue DNS/META checks. Deterministic job ids dedupe repeats. */
export async function sweepDueChecks(db: SweepStore, q: JobEnqueuer, now: Date = systemClock.now()): Promise<number> {
  const pending = await db.sellerOwnershipClaim.findMany({ where: { status: "PENDING", method: { in: [...WORKER_CHECKED_METHODS, "BUSINESS_EMAIL_DOMAIN"] }, nextCheckAt: { lte: now } }, take: 200 });
  const verified = (await db.sellerOwnershipClaim.findMany({ where: { status: "VERIFIED", method: { in: [...WORKER_CHECKED_METHODS] } }, take: 500 })).filter((c) => isRecheckDue(c as never, now));
  let n = 0;
  for (const c of pending) { await q.add("verification.check", { claimId: c.id }, { jobId: `claimcheck__${c.id}__${c.lastCheckAt?.getTime() ?? 0}` }); n++; }
  for (const c of verified) { await q.add("verification.check", { claimId: c.id }, { jobId: `claimreverify__${c.id}__${Math.floor(now.getTime() / (c.graceEndsAt ? 24 * 3_600_000 : DAY_MS))}` }); n++; }
  return n;
}

/** claims-expire (15 min): challenge / info timeouts. Each call is a guarded, idempotent transition. */
export async function sweepExpiry(db: SweepStore, now: Date = systemClock.now()): Promise<number> {
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
export async function sweepGrace(db: SweepStore, now: Date = systemClock.now()): Promise<{ graceStarted: number; expired: number }> {
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
