import { z } from "zod";

/** The 13 policy categories (pipeline §2.2). */
export const CATEGORIES = [
  "spam", "fake_or_misleading", "conflict_of_interest", "off_topic", "harassment_hate", "sexual", "sexual_minors",
  "violence_threats", "self_harm", "personal_information", "illegal_goods", "intellectual_property", "malicious_link",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CONTENT_TYPES = ["REVIEW", "SELLER_REPLY", "COMMENT", "POST", "MEDIA"] as const;
export const TRUST_BANDS = ["NEW", "LOW", "MEDIUM", "HIGH"] as const;
export type TrustBand = (typeof TRUST_BANDS)[number];

/** Floors that no config (or raw SQL row) can weaken: classify() reads these, not the config object (CFG-002). */
export const HARD_FLOORS = {
  zeroTolerance: ["sexual_minors"] as readonly string[],
  zeroToleranceMaxViolation: 0.5,
  forceUnsure: { unsupportedLanguage: true, mediaTimeout: true, malwareMedia: true, resubmitAfterHuman: true },
} as const;

const unit = z.number().min(0).max(1);
export const thresholdSchema = z
  .object({ clean: unit, violation: unit.nullable() })
  .strict()
  .refine((t) => t.violation === null || t.clean < t.violation, { message: "clean must be < violation" });
export type Threshold = z.infer<typeof thresholdSchema>;

const bandRecord = <T extends z.ZodTypeAny>(v: T) => z.object({ NEW: v, LOW: v, MEDIUM: v, HIGH: v }).strict();

export const moderationConfigSchema = z
  .object({
    version: z.string().min(1).max(32),
    policyVersion: z.string().min(1).max(32),
    defaults: thresholdSchema,
    categories: z.object(Object.fromEntries(CATEGORIES.map((c) => [c, thresholdSchema])) as Record<Category, typeof thresholdSchema>).strict(),
    contentTypes: z.partialRecord(z.enum(CONTENT_TYPES), z.object({ categories: z.partialRecord(z.enum(CATEGORIES), thresholdSchema) }).strict()).default({}),
    forceUnsure: z
      .object({
        unsupportedLanguage: z.boolean(),
        mediaTimeout: z.boolean().default(true),
        malwareMedia: z.boolean().default(true),
        resubmitAfterHuman: z.boolean().default(true),
        externalLinkIn: z.array(z.enum(CONTENT_TYPES)),
        firstReviewsOfNewAccount: z.number().int().min(0).default(0),
        extremeRatingVelocity: z.object({ enabled: z.boolean(), reviewsPerHour: z.number().int().min(1) }).strict(),
      })
      .strict(),
    trustBands: bandRecord(z.object({ unsureIfAnyAbove: unit.nullable() }).strict()),
    postReview: z.object({ sampleRate: bandRecord(unit), lapseAfterHours: z.number().int().min(1).max(720) }).strict(),
    timers: z
      .object({
        postReviewSlaHours: z.number().int().min(1).max(168),
        holdDays: z.number().int().min(1).max(30),
        holdReminderHours: z.number().int().min(1).max(168),
        appealWindowDays: z.number().int().min(14).max(90),
        appealSlaHours: z.number().int().min(1),
        appealSlaHoursHoldExpired: z.number().int().min(1),
        reportedSlaHours: z.number().int().min(1).max(168).default(48),
      })
      .strict(),
    ai: z
      .object({
        timeoutMs: z.number().int().min(1000).max(120_000),
        maxAttempts: z.number().int().min(1).max(5),
        backoffMs: z.array(z.number().int().min(0)).min(1),
        maxPendingMinutes: z.number().int().min(1),
        rescanOnRecovery: z.boolean(),
        maxRescans: z.number().int().min(0).max(10),
        circuitBreaker: z.object({ windowSize: z.number().int().min(1), failureRatio: unit, openSeconds: z.number().int().min(1) }).strict(),
        rateLimit: z.object({ max: z.number().int().min(1), durationMs: z.number().int().min(1) }).strict(),
      })
      .strict(),
    media: z.object({ maxWaitMinutes: z.number().int().min(1), videoFrameSampleFps: z.number().min(0), videoMaxFrames: z.number().int().min(0) }).strict(),
    strikes: z
      .object({
        windowDays: z.number().int().min(1),
        ladder: z.array(z.object({ count: z.number().int().min(1), action: z.string(), days: z.number().int().nullable().optional(), requiresSeniorReview: z.boolean().optional() })),
        zeroTolerance: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type ModerationConfig = z.infer<typeof moderationConfigSchema>;

export class ConfigFloorViolation extends Error {
  readonly code = "config_floor_violation";
  constructor(public issues: string[]) {
    super(`config_floor_violation: ${issues.join("; ")}`);
  }
}

/** Shape + bounds (CFG-001/005) and hard floors (CFG-002). Throws zod errors or ConfigFloorViolation. */
export function validateModerationConfig(raw: unknown): ModerationConfig {
  const cfg = moderationConfigSchema.parse(raw);
  const issues: string[] = [];
  for (const c of HARD_FLOORS.zeroTolerance) if (!cfg.strikes.zeroTolerance.includes(c)) issues.push(`strikes.zeroTolerance must include ${c}`);
  for (const c of cfg.strikes.zeroTolerance) {
    const v = cfg.categories[c as Category]?.violation;
    if (v === null || v === undefined || v > HARD_FLOORS.zeroToleranceMaxViolation) issues.push(`${c}.violation must be <= ${HARD_FLOORS.zeroToleranceMaxViolation}`);
  }
  for (const k of Object.keys(HARD_FLOORS.forceUnsure) as (keyof typeof HARD_FLOORS.forceUnsure)[]) {
    if (cfg.forceUnsure[k] !== true) issues.push(`forceUnsure.${k} must be true`);
  }
  if (issues.length) throw new ConfigFloorViolation(issues);
  return cfg;
}

/** Lookup order (CLS-011): contentTypes.<TYPE>.categories.<cat> -> categories.<cat> -> defaults. */
export function thresholdFor(cfg: ModerationConfig, type: (typeof CONTENT_TYPES)[number], cat: Category): Threshold {
  return cfg.contentTypes[type]?.categories?.[cat] ?? cfg.categories[cat] ?? cfg.defaults;
}

/** SHA-256 hex of the canonical JSON; computed by the caller with node:crypto (kept out of this pure module). */
export const canonicalJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
