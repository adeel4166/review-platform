import { openSecret, sealSecret, totpAad, type KeyRing } from "@rp/core";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ReencryptDeps { db: any; ring: KeyRing }
export interface ReencryptReport { migrated: number; failed: number; rowsPerKeyId: Record<string, number>; /** Keys with zero rows in every table: only these may leave the secret store. */ removableKeys: string[]; done: boolean }

const bump = (m: Record<string, number>, k: string | null | undefined) => { if (k) m[k] = (m[k] ?? 0) + 1; };

/**
 * OPS-002 `security.totp-reencrypt` (manual): re-encrypts TwoFactorTotp rows (active and pending secret) to the ring's active `keyId` in batches,
 * verifies by decrypting the new ciphertext, then reports rows per keyId. It refuses to say `done` while any row still uses another key.
 * Recovery-code pepper keys are reported too: codes are HMACs and cannot be re-keyed, so an old pepper stays until its rows are used up or reissued.
 */
export async function reencryptTotp(d: ReencryptDeps, batch = 100): Promise<ReencryptReport> {
  const active = d.ring.active;
  let migrated = 0, failed = 0;
  const bad = new Set<string>();
  for (const [secret, keyField, secretField] of [["active", "keyId", "secretCiphertext"], ["pending", "pendingKeyId", "pendingSecretCiphertext"]] as const) {
    for (;;) {
      const rows: any[] = await d.db.twoFactorTotp.findMany({ where: { [secretField]: { not: null }, [keyField]: { not: active } }, take: batch });
      const todo = rows.filter((r) => !bad.has(`${r.id}:${secret}`));
      if (!todo.length) break;
      for (const r of todo) {
        try {
          const aad = totpAad(r.userId, r.id);
          const plain = openSecret(d.ring, r[keyField], r[secretField], aad);
          const sealed = sealSecret(d.ring, plain, aad);
          if (!openSecret(d.ring, sealed.keyId, sealed.ciphertext, aad).equals(plain)) throw new Error("verify");
          await d.db.twoFactorTotp.update({ where: { id: r.id }, data: { [secretField]: sealed.ciphertext, [keyField]: sealed.keyId } });
          migrated++;
        } catch { failed++; bad.add(`${r.id}:${secret}`); }
      }
    }
  }
  const rowsPerKeyId: Record<string, number> = {};
  for (const r of await d.db.twoFactorTotp.findMany({ where: {} })) { if (r.secretCiphertext) bump(rowsPerKeyId, r.keyId); if (r.pendingSecretCiphertext) bump(rowsPerKeyId, r.pendingKeyId); }
  for (const r of await d.db.recoveryCode.findMany({ where: {} })) bump(rowsPerKeyId, r.keyId);
  const removableKeys = Object.keys(d.ring.keys).filter((k) => k !== active && !rowsPerKeyId[k]);
  const stillOld = Object.entries(rowsPerKeyId).some(([k, n]) => k !== active && n > 0);
  return { migrated, failed, rowsPerKeyId, removableKeys, done: failed === 0 && !stillOld };
}
