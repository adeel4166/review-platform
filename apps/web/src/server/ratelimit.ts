import { Redis } from "ioredis";
import { clientIp, consumeAll, loadRateLimitConfig, type RateLimitConfig, type RateLimitFailMode, type RateLimitRedis, type RateRule } from "@rp/core";
import { HttpError } from "./http";

let redis: RateLimitRedis | undefined;
let cfg: RateLimitConfig | undefined;

export const rateConfig = () => (cfg ??= loadRateLimitConfig());

function getRedis(): RateLimitRedis {
  // Lazy: never connects at import/build time. Commands fail fast (no offline queue) so an outage is detected quickly (login/register then fall back to the in-process limiter).
  return (redis ??= new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false }) as unknown as RateLimitRedis);
}

/** Test seam. */
export function configureRateLimit(r: RateLimitRedis | undefined, c?: Partial<RateLimitConfig>) {
  redis = r;
  cfg = c ? { ...loadRateLimitConfig({}), ...c } : undefined;
}

export const ipOf = (req: Request) => clientIp(req.headers, rateConfig());

const rule = (limit: number, windowSeconds: number): RateRule => ({ limit, windowSeconds });
type Check = { key: string; rule: RateRule; mode?: RateLimitFailMode };
/** Auth endpoints fail CLOSED (in-process fallback) on Redis errors; review/upload stay fail-open (R-1). */
const closed = (c: Omit<Check, "mode">): Check => ({ ...c, mode: "closed" });
const MIN = 60, HOUR = 3600, DAY = 86400;

/** Throws 429 + Retry-After when any check is exceeded. */
async function enforce(checks: Check[]) {
  if (!rateConfig().RATE_LIMIT_ENABLED) return;
  const d = await consumeAll(getRedis(), checks);
  if (!d.allowed) {
    throw new HttpError(429, "rate_limited", "Too many requests, try again later", { "Retry-After": String(d.retryAfterSeconds) });
  }
}

export const limitLogin = (req: Request, email: string) => {
  const c = rateConfig(), who = `${ipOf(req)}:${email.trim().toLowerCase()}`;
  return enforce([
    closed({ key: `login:m:${who}`, rule: rule(c.RATE_LOGIN_PER_MIN, MIN) }),
    closed({ key: `login:h:${who}`, rule: rule(c.RATE_LOGIN_PER_HOUR, HOUR) }),
  ]);
};

export const limitRegister = (req: Request) =>
  enforce([closed({ key: `register:h:${ipOf(req)}`, rule: rule(rateConfig().RATE_REGISTER_PER_HOUR, HOUR) })]);

/** Token confirmation and resend: per IP, fail closed (token guessing / mail flooding). */
export const limitVerifyEmail = (req: Request) =>
  enforce([closed({ key: `verify:h:${ipOf(req)}`, rule: rule(30, HOUR) })]);

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

/**
 * 2FA code checks (m3b-spec 2.6). "attempt" is charged per check (stricter than per failure): 10 / 15 min per account across
 * all sessions, 30 / 15 min per IP. Fail closed: the in-process fallback keeps counting when Redis is down.
 */
export const limit2fa = (req: Request, kind: "attempt" | "enrol" | "regenerate" | "disable", userId: string) =>
  enforce(
    kind === "attempt"
      ? [closed({ key: `2fa:acct:${userId}`, rule: rule(10, 15 * MIN) }), closed({ key: `2fa:ip:${ipOf(req)}`, rule: rule(30, 15 * MIN) })]
      : [closed({ key: `2fa:${kind}:${userId}`, rule: rule(kind === "enrol" ? 5 : 3, kind === "enrol" ? HOUR : DAY) })],
  );

/** Unauthenticated one-click links (ownership-change cancel, claim-mail deny): 10 / min per IP, fail closed (m3b-spec 3.4, 4.4). */
export const limitTokenLink = (req: Request) => enforce([closed({ key: `tokenlink:m:${ipOf(req)}`, rule: rule(10, MIN) })]);

/** Seller reply create (m3b-spec 5.6): 20/h and 100/day per user, 300/day per seller. Fail open like review writes. */
export const limitReplyCreate = (userId: string, sellerId: string) =>
  enforce([
    { key: `reply:u:h:${userId}`, rule: rule(20, HOUR) },
    { key: `reply:u:d:${userId}`, rule: rule(100, DAY) },
    { key: `reply:s:d:${sellerId}`, rule: rule(300, DAY) },
  ]);

/** Reply edits: 5/day per reply. */
export const limitReplyEdit = (replyId: string) => enforce([{ key: `reply:edit:d:${replyId}`, rule: rule(5, DAY) }]);

/** Votes (m4-m5-spec 2.1): 60/h per user (NEW accounts 20/h), 300/h per ipHash. Fail open like other content limits. */
export const limitVote = (userId: string, ipHash: string | null, newAccount: boolean) =>
  enforce([
    { key: `vote:u:h:${userId}`, rule: rule(newAccount ? 20 : 60, HOUR) },
    ...(ipHash ? [{ key: `vote:ip:h:${ipHash}`, rule: rule(300, HOUR) }] : []),
  ]);

/** Edits of PUBLISHED reviews: 5 per user per day (threat-model section 5). */
export const limitReviewEdit = (userId: string) => enforce([{ key: `review:edit:u:d:${userId}`, rule: rule(5, DAY) }]);

/** Reports: 20/day per user, 50/day per ipHash. */
export const limitReport = (userId: string, ipHash: string | null) =>
  enforce([
    { key: `report:u:d:${userId}`, rule: rule(20, DAY) },
    ...(ipHash ? [{ key: `report:ip:d:${ipHash}`, rule: rule(50, DAY) }] : []),
  ]);

/** Proof creations: 5 per user per day. */
export const limitProofCreate = (userId: string) => enforce([{ key: `proof:u:d:${userId}`, rule: rule(5, DAY) }]);

/** Keyed hash of the client IP for anti-abuse data (L-11: nulled after 90 days by the retention sweep). */
export { hashIp } from "@rp/core";

/** AP-3: `appeal.create` 3 per day per user. Fails closed (appeals are rare and abuse-prone). */
export const limitAppeal = (userId: string) => enforce([closed({ key: `appeal:${userId}`, rule: rule(3, DAY) })]);
/** SEC-M4-06 / MOD-015: author edits and resubmits share `content.edit`, 5 per rolling 24 h. */
export const limitContentEdit = (userId: string) => enforce([{ key: `content.edit:${userId}`, rule: rule(5, DAY) }]);
