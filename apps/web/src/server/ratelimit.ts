import { Redis } from "ioredis";
import { clientIp, consumeAll, loadRateLimitConfig, type RateLimitConfig, type RateLimitRedis, type RateRule } from "@rp/core";
import { HttpError } from "./http";

let redis: RateLimitRedis | undefined;
let cfg: RateLimitConfig | undefined;

export const rateConfig = () => (cfg ??= loadRateLimitConfig());

function getRedis(): RateLimitRedis {
  // Lazy: never connects at import/build time. Commands fail fast (no offline queue) so an outage fails open quickly.
  return (redis ??= new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false }) as unknown as RateLimitRedis);
}

/** Test seam. */
export function configureRateLimit(r: RateLimitRedis | undefined, c?: Partial<RateLimitConfig>) {
  redis = r;
  cfg = c ? { ...loadRateLimitConfig({}), ...c } : undefined;
}

export const ipOf = (req: Request) => clientIp(req.headers, rateConfig());

const rule = (limit: number, windowSeconds: number): RateRule => ({ limit, windowSeconds });
const MIN = 60, HOUR = 3600, DAY = 86400;

/** Throws 429 + Retry-After when any check is exceeded. */
async function enforce(checks: { key: string; rule: RateRule }[]) {
  if (!rateConfig().RATE_LIMIT_ENABLED) return;
  const d = await consumeAll(getRedis(), checks);
  if (!d.allowed) {
    throw new HttpError(429, "rate_limited", "Too many requests, try again later", { "Retry-After": String(d.retryAfterSeconds) });
  }
}

export const limitLogin = (req: Request, email: string) => {
  const c = rateConfig(), who = `${ipOf(req)}:${email.trim().toLowerCase()}`;
  return enforce([
    { key: `login:m:${who}`, rule: rule(c.RATE_LOGIN_PER_MIN, MIN) },
    { key: `login:h:${who}`, rule: rule(c.RATE_LOGIN_PER_HOUR, HOUR) },
  ]);
};

export const limitRegister = (req: Request) =>
  enforce([{ key: `register:h:${ipOf(req)}`, rule: rule(rateConfig().RATE_REGISTER_PER_HOUR, HOUR) }]);

/** Review create and edit share the budget: both enqueue moderation work. */
export const limitReviewWrite = (req: Request, userId: string) => {
  const c = rateConfig();
  return enforce([
    { key: `review:u:h:${userId}`, rule: rule(c.RATE_REVIEW_USER_PER_HOUR, HOUR) },
    { key: `review:u:d:${userId}`, rule: rule(c.RATE_REVIEW_USER_PER_DAY, DAY) },
    { key: `review:ip:h:${ipOf(req)}`, rule: rule(c.RATE_REVIEW_IP_PER_HOUR, HOUR) },
  ]);
};

export const limitUploadSlot = (userId: string) =>
  enforce([{ key: `upload:u:h:${userId}`, rule: rule(rateConfig().RATE_UPLOAD_SLOTS_PER_HOUR, HOUR) }]);
