import { z } from "zod";

/** ADR-0033 §2 / SEC-M4-09 gap 2: retention values come from a validated object; an unknown enum value refuses to boot. */
export const PROOF_ORIGINAL_MODES = ["AT_DECISION", "APPEAL_WINDOW"] as const;
const days = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def);
export const retentionConfigSchema = z.object({
  PROOF_ORIGINAL_RETENTION: z.enum(PROOF_ORIGINAL_MODES).default("AT_DECISION"),
  RET_PROOF_REDACTED_DAYS: days(90, 1, 3650),
  RET_PROOF_TOMBSTONE_DAYS: days(365, 30, 3650),
  RET_EVIDENCE_DAYS: days(90, 1, 3650),
  RET_CONTENT_DELETED_DAYS: days(90, 1, 3650),
  RET_MEDIA_REJECTED_DAYS: days(60, 1, 3650),
  RET_SNAPSHOT_DAYS: days(730, 30, 3650),
  RET_SESSION_DAYS: days(30, 1, 365),
  RET_TOKEN_DAYS: days(7, 1, 365),
  RET_IPHASH_DAYS: days(90, 1, 90), // PRV-011: never longer than 90 days
  RET_NOTIF_READ_DAYS: days(180, 1, 3650),
  RET_NOTIF_UNREAD_DAYS: days(365, 1, 3650),
  RET_OUTBOX_DAYS: days(7, 1, 365),
  RET_AUDIT_DAYS: days(730, 90, 3650),
  RET_BREAKGLASS_DAYS: days(730, 30, 3650),
  RET_LSH_DAYS: days(90, 1, 365),
});
export type RetentionConfig = z.infer<typeof retentionConfigSchema>;

export function loadRetentionConfig(source: Record<string, string | undefined> = process.env): RetentionConfig {
  const pick = Object.fromEntries(Object.keys(retentionConfigSchema.shape).filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));
  const r = retentionConfigSchema.safeParse(pick);
  if (!r.success) throw new Error(`Invalid retention config, check: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}`); // names only
  return r.data;
}
