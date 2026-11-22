/**
 * T-01 / ADR-0015: worker groups. `core` (default) runs everything except network egress for ownership verification;
 * `verification-egress` runs ONLY the DNS/META observer and must hold no secrets beyond REDIS_URL + VERIFY_DNS_SERVERS.
 * `media` (INF-008) runs ONLY the media queue (untrusted parsers) and must hold no AI key, SMTP URL or 2FA/auth secrets.
 */
export const WORKER_GROUPS = ["core", "verification-egress", "media"] as const;
export type WorkerGroup = (typeof WORKER_GROUPS)[number];

/** Env var names (or prefixes) that must never exist in the egress process: it fetches attacker-controlled URLs. */
const FORBIDDEN_EXACT = ["DATABASE_URL", "SMTP_URL", "AUTH_SECRET", "TOTP_ENC_KEYS", "TOTP_ENC_ACTIVE_KEY_ID", "RECOVERY_CODE_PEPPERS", "RECOVERY_CODE_ACTIVE_KEY_ID"];
const FORBIDDEN_PREFIX = ["S3_"];

export function parseWorkerGroup(raw: string | undefined): WorkerGroup {
  const v = (raw ?? "core").trim() || "core";
  if (!(WORKER_GROUPS as readonly string[]).includes(v)) {
    throw new Error(`WORKER_GROUPS must be exactly one of: ${WORKER_GROUPS.join(", ")} (got "${v}"; groups are never combined)`);
  }
  return v as WorkerGroup;
}

/** Names of forbidden variables present in `env` (values are never read or returned). */
export function forbiddenEgressEnv(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter((k) => env[k] !== undefined && (FORBIDDEN_EXACT.includes(k) || FORBIDDEN_PREFIX.some((p) => k.startsWith(p)))).sort();
}

/** Throws when the egress group is started with credentials it must not have. Callers exit non-zero. */
export function assertEgressEnv(env: Record<string, string | undefined>): void {
  const bad = forbiddenEgressEnv(env);
  if (bad.length) throw new Error(`verification-egress refuses to start: forbidden env present: ${bad.join(", ")}`);
  if (!env.REDIS_URL) throw new Error("verification-egress requires REDIS_URL");
}

/** INF-008 / R-3: the media group parses attacker-controlled files, so a decoder compromise must not reach the AI key, mail or auth secrets. */
const MEDIA_FORBIDDEN_EXACT = ["SMTP_URL", "AUTH_SECRET", "TOTP_ENC_KEYS", "TOTP_ENC_ACTIVE_KEY_ID", "RECOVERY_CODE_PEPPERS", "RECOVERY_CODE_ACTIVE_KEY_ID"];
const MEDIA_FORBIDDEN_PREFIX = ["MODERATION_", "ANTHROPIC_", "OPENAI_", "AI_", "SMTP_"];

/** Names of variables the media group must not have (values are never read or returned). */
export function forbiddenMediaEnv(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter((k) => env[k] !== undefined && (MEDIA_FORBIDDEN_EXACT.includes(k) || MEDIA_FORBIDDEN_PREFIX.some((p) => k.startsWith(p)))).sort();
}

/** Throws when the media group is started with the AI key (or other forbidden secrets). main.ts exits 1. */
export function assertMediaEnv(env: Record<string, string | undefined>): void {
  const bad = forbiddenMediaEnv(env);
  if (bad.length) throw new Error(`media refuses to start: forbidden env present: ${bad.join(", ")}`);
  if (!env.REDIS_URL) throw new Error("media requires REDIS_URL");
}
