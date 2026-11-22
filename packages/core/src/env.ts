import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("auto"),
  S3_FORCE_PATH_STYLE: bool.default(false),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_INGEST: z.string().min(1),
  S3_BUCKET_PRIVATE: z.string().min(1),
  S3_BUCKET_PUBLIC: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  UPLOAD_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  MODERATION_PROVIDER: z.string().min(1).default("mock"),
  MODERATION_API_KEY: z.string().min(1).optional(), // secret: env only, never logged
  /** OPS-004: log scrubber and error-tracker beforeSend. Defaults on; `off` is refused when NODE_ENV=production. */
  LOG_SCRUB: z.enum(["on", "off"]).default("on"),
  /** SEC-M4-09 gap 2: validated enum, an unknown value refuses to boot. */
  PROOF_ORIGINAL_RETENTION: z.enum(["AT_DECISION", "APPEAL_WINDOW"]).default("AT_DECISION"),
  /** OPS-001: write-only ledger bucket (ADR-0033 §4); optional outside production. */
  S3_BUCKET_LEDGER: z.string().min(1).optional(),
  S3_BUCKET_AUDIT_ARCHIVE: z.string().min(1).optional(),
}).superRefine((v, ctx) => {
  if (v.NODE_ENV === "production" && v.LOG_SCRUB !== "on") ctx.addIssue({ code: "custom", path: ["LOG_SCRUB"], message: "must be on in production" });
});
export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment, check: ${keys}`); // names only, never values
  }
  return parsed.data;
}
