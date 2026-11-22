import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSecret, sealSecret, totpAad, type KeyRing } from "@rp/core";
import { makeFakeDb } from "../test-fake-db";
import { reencryptTotp } from "./totp-reencrypt";

const k1 = randomBytes(32), k2 = randomBytes(32);
const oldRing: KeyRing = { active: "k1", keys: { k1 } };
const ring: KeyRing = { active: "k2", keys: { k1, k2 } };

function seed(n: number) {
  const h = makeFakeDb(["twoFactorTotp", "recoveryCode"]);
  for (let i = 0; i < n; i++) {
    const id = `t${i}`, userId = `u${i}`, secret = randomBytes(20);
    const s = sealSecret(oldRing, secret, totpAad(userId, id));
    const p = sealSecret(oldRing, secret, totpAad(userId, id));
    h.t.twoFactorTotp!.push({ id, userId, secretCiphertext: s.ciphertext, keyId: s.keyId, pendingSecretCiphertext: i === 0 ? p.ciphertext : null, pendingKeyId: i === 0 ? p.keyId : null, _secret: secret });
  }
  h.t.recoveryCode!.push({ id: "rc", userId: "u0", keyId: "k1" });
  return h;
}

describe("OPS-002 TOTP key rotation drill", () => {
  it("re-encrypts every row to the new keyId in batches, verifies decrypt, and reports counts", async () => {
    const h = seed(5);
    const r = await reencryptTotp({ db: h.db, ring }, 2);
    expect(r.migrated).toBe(6); // 5 active + 1 pending
    expect(r.failed).toBe(0);
    for (const row of h.t.twoFactorTotp!) {
      expect(row.keyId).toBe("k2");
      expect(openSecret(ring, "k2", row.secretCiphertext as Buffer, totpAad(row.userId as string, row.id as string)).equals(row._secret as Buffer)).toBe(true);
    }
    expect(r.rowsPerKeyId.k2).toBe(6);
  });
  it("refuses to report done while recovery codes still use the old pepper key: old key is not removable", async () => {
    const h = seed(2);
    const r = await reencryptTotp({ db: h.db, ring });
    expect(r.rowsPerKeyId.k1).toBe(1);
    expect(r.done).toBe(false);
    expect(r.removableKeys).not.toContain("k1");
    h.t.recoveryCode!.length = 0;
    const r2 = await reencryptTotp({ db: h.db, ring });
    expect(r2).toMatchObject({ done: true, migrated: 0, removableKeys: ["k1"] });
  });
  it("a row that cannot be decrypted is reported, not skipped silently, and blocks done", async () => {
    const h = seed(2);
    h.t.twoFactorTotp![1]!.secretCiphertext = Buffer.from("garbage-garbage-garbage-garbage-garbage");
    h.t.recoveryCode!.length = 0;
    const r = await reencryptTotp({ db: h.db, ring });
    expect(r.failed).toBe(1);
    expect(r.done).toBe(false);
    expect(r.removableKeys).not.toContain("k1");
  });
});
