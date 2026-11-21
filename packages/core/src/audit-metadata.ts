/**
 * SEC-09(c): audit metadata is returned raw by /api/admin/audit, so it must never carry PII.
 * Ids, enum values, counters and the reviewer's free-text `reason` are fine; email, IP and name fields are not.
 */
const FORBIDDEN_KEY = /^(e-?mail|mail|ip|ip_?addr(ess)?|client_?ip|remote_?addr|x_?forwarded_?for|user_?agent|name|first_?name|last_?name|full_?name|display_?name|real_?name|handle|username|phone)$/i;

/** Returns the dotted paths of forbidden keys found anywhere in the metadata (empty = clean). */
export function findPiiAuditKeys(meta: unknown, path = ""): string[] {
  if (Array.isArray(meta)) return meta.flatMap((v, i) => findPiiAuditKeys(v, `${path}[${i}]`));
  if (meta && typeof meta === "object") {
    return Object.entries(meta as Record<string, unknown>).flatMap(([k, v]) => {
      const p = path ? `${path}.${k}` : k;
      return [...(FORBIDDEN_KEY.test(k.replace(/[-\s]/g, "_")) ? [p] : []), ...findPiiAuditKeys(v, p)];
    });
  }
  return [];
}

/** Throws (a programming error, caught in tests/dev) when audit metadata contains PII-shaped keys. */
export function assertAuditMetadataClean(meta: unknown): void {
  const bad = findPiiAuditKeys(meta);
  if (bad.length) throw new Error(`audit metadata must not contain email/IP/name fields: ${bad.join(", ")}`);
}
