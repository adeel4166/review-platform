import { z } from "zod";

/** Minimal Redis surface the limiter needs (ioredis satisfies it); keeps core free of a Redis dependency. */
export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
}

export interface RateRule {
  /** Max requests per window. */
  limit: number;
  windowSeconds: number;
}
export type RateDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export type RateLimitFailMode = "open" | "closed";

/** Alert/metric hook: called on every limiter backend error. Replace with a real metrics emitter at wiring time. */
export type RateLimitErrorHook = (e: { key: string; mode: RateLimitFailMode; error: string }) => void;
const defaultErrorHook: RateLimitErrorHook = (e) =>
  console.error(JSON.stringify({ msg: "ratelimit.error", metric: "ratelimit_backend_error_total", mode: e.mode, err: e.error }));
let errorHook: RateLimitErrorHook = defaultErrorHook;
export function setRateLimitErrorHook(h: RateLimitErrorHook | undefined) { errorHook = h ?? defaultErrorHook; }

/** Fixed-window counter on any RateLimitRedis-shaped store. Throws on store errors. */
async function count(redis: RateLimitRedis, key: string, rule: RateRule): Promise<RateDecision> {
  const n = await redis.incr(key);
  if (n === 1) await redis.pexpire(key, rule.windowSeconds * 1000);
  if (n <= rule.limit) return { allowed: true, remaining: rule.limit - n };
  let ttl = await redis.pttl(key);
  if (ttl < 0) {
    // Key without expiry (crash between INCR and PEXPIRE): repair it so it cannot lock the caller out forever.
    await redis.pexpire(key, rule.windowSeconds * 1000);
    ttl = rule.windowSeconds * 1000;
  }
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
}

/** Per-process fallback used when Redis errors on a fail-closed rule. Per-instance (not shared), which is still bounded. */
let fallback: RateLimitRedis | undefined;
/** Test seam. */
export const setRateLimitFallback = (s: RateLimitRedis | undefined) => { fallback = s; };

/**
 * Fixed-window counter: INCR, set expiry on first hit.
 * On Redis errors the error is logged + hooked, then:
 *  - mode "open" (reviews, uploads): the request is allowed (an outage must not take writes down);
 *  - mode "closed" (login, register): the in-process limiter decides, so attempts stay bounded (SEC R-1).
 */
export async function consume(redis: RateLimitRedis, key: string, rule: RateRule, mode: RateLimitFailMode = "open"): Promise<RateDecision> {
  try {
    return await count(redis, key, rule);
  } catch (e) {
    try { errorHook({ key: key.split(":").slice(0, 2).join(":"), mode, error: e instanceof Error ? e.message : "unknown" }); } catch { /* hook must never break requests */ }
    if (mode === "open") return { allowed: true, remaining: rule.limit };
    try {
      return await count((fallback ??= new MemoryRateLimitStore()), key, rule);
    } catch {
      return { allowed: false, retryAfterSeconds: Math.min(rule.windowSeconds, 60) };
    }
  }
}

/** Checks every rule; the first exceeded one wins. Rules are all counted (no short-circuit) so windows stay consistent. */
export async function consumeAll(redis: RateLimitRedis, checks: { key: string; rule: RateRule; mode?: RateLimitFailMode }[]): Promise<RateDecision> {
  let denied: RateDecision | undefined;
  for (const c of checks) {
    const d = await consume(redis, `rl:${c.key}`, c.rule, c.mode);
    if (!d.allowed && (!denied || (denied.allowed === false && d.retryAfterSeconds > denied.retryAfterSeconds))) denied = d;
  }
  return denied ?? { allowed: true, remaining: 0 };
}

/** In-memory store: test double and the fail-closed fallback. Time is injectable. */
export class MemoryRateLimitStore implements RateLimitRedis {
  private data = new Map<string, { n: number; exp: number | null }>();
  constructor(private now: () => number = Date.now) {}
  private live(key: string) {
    const e = this.data.get(key);
    if (e && e.exp !== null && e.exp <= this.now()) { this.data.delete(key); return undefined; }
    return e;
  }
  async incr(key: string) {
    const e = this.live(key) ?? { n: 0, exp: null };
    e.n += 1;
    this.data.set(key, e);
    if (this.data.size > 10_000) for (const k of [...this.data.keys()]) this.live(k); // prune expired entries
    return e.n;
  }
  async pexpire(key: string, ms: number) {
    const e = this.live(key);
    if (e) e.exp = this.now() + ms;
    return e ? 1 : 0;
  }
  async pttl(key: string) {
    const e = this.live(key);
    return !e ? -2 : e.exp === null ? -1 : e.exp - this.now();
  }
}

export { MemoryRateLimitStore as FakeRateLimitRedis };

/** Limits are configuration (env), never literals at call sites. Defaults follow the M2 security review (SEC-03). */
const int = (d: number) => z.coerce.number().int().positive().default(d);
export const rateLimitEnvSchema = z.object({
  RATE_LIMIT_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  RATE_LOGIN_PER_MIN: int(5),
  RATE_LOGIN_PER_HOUR: int(20),
  RATE_REGISTER_PER_HOUR: int(5),
  RATE_REVIEW_USER_PER_HOUR: int(10),
  RATE_REVIEW_USER_PER_DAY: int(30),
  RATE_REVIEW_IP_PER_HOUR: int(30),
  RATE_UPLOAD_SLOTS_PER_HOUR: int(20),
  /** Per-user cap on slots created per rolling 24 h, counting FAILED ones (DB-backed, survives Redis loss). */
  MEDIA_DAILY_QUOTA: int(50),
  /** Number of trusted reverse proxies in front of the app (0 = trust no forwarding header). See clientIp(). */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  CLIENT_IP_HEADER: z.string().min(1).default("x-forwarded-for"),
});
export type RateLimitConfig = z.infer<typeof rateLimitEnvSchema>;
export const loadRateLimitConfig = (source: Record<string, string | undefined> = process.env): RateLimitConfig =>
  rateLimitEnvSchema.parse(source);

/**
 * Client IP from a forwarding header, trusting exactly `hops` proxies we operate: the entry `hops` from the right is
 * the address our outermost trusted proxy saw. Anything the client put further left is ignored (spoof-proof).
 * hops = 0 means no proxy is trusted: headers are ignored and every caller falls into the "unknown" bucket.
 */
export function clientIp(headers: { get(name: string): string | null }, cfg: Pick<RateLimitConfig, "TRUSTED_PROXY_HOPS" | "CLIENT_IP_HEADER">): string {
  if (cfg.TRUSTED_PROXY_HOPS === 0) return "unknown";
  const raw = headers.get(cfg.CLIENT_IP_HEADER);
  if (!raw) return "unknown";
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const ip = parts[Math.max(0, parts.length - cfg.TRUSTED_PROXY_HOPS)];
  return ip && ip.length <= 64 ? ip : "unknown";
}
