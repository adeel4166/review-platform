/**
 * T-01 / ADR-0015: worker groups. `core` (default) runs everything except network egress for ownership verification;
 * `verification-egress` runs ONLY the DNS/META observer and must hold no secrets beyond REDIS_URL + VERIFY_DNS_SERVERS.
 */
export const WORKER_GROUPS = ["core", "verification-egress"] as const;
export type WorkerGroup = (typeof WORKER_GROUPS)[number];

/** Env var names (or prefixes) that must never exist in the egress process: it fetches attacker-controlled URLs. */
const FORBIDDEN_EXACT = ["DATABASE_URL", "SMTP_URL"];
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
