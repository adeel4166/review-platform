import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateRecoveryCode, hashRecoveryCode, hotp, isRecoveryCodeShape, matchTotp, normalizeRecoveryCode, openSecret, otpauthUri, parseKeyRing, sealSecret, totpAad } from "./two-factor";

// RFC 6238 appendix B (SHA-1, secret "12345678901234567890"), truncated to 6 digits.
const RFC = Buffer.from("12345678901234567890");
const ring = (id = "k1") => parseKeyRing(JSON.stringify({ [id]: Buffer.alloc(32, 7).toString("base64") }), id);

describe("TOTP", () => {
  it.each([[59, "287082"], [1111111109, "081804"], [2000000000, "279037"]])("RFC 6238 vector at t=%i", (t, code) => {
    expect(hotp(RFC, Math.floor(t / 30))).toBe(code);
    expect(matchTotp(RFC, code, t * 1000)).toBe(Math.floor(t / 30));
  });
  it("accepts +-1 step, rejects +-2 and malformed codes", () => {
    const t = 1111111109 * 1000;
    expect(matchTotp(RFC, "081804", t + 30_000)).toBe(37037036);
    expect(matchTotp(RFC, "081804", t + 90_000)).toBeNull();
    expect(matchTotp(RFC, "08180", t)).toBeNull();
    expect(matchTotp(RFC, "08180a", t)).toBeNull();
  });
  it("base32 round-trips and the URI carries the secret", () => {
    expect(base32Decode(base32Encode(RFC)).equals(RFC)).toBe(true);
    expect(otpauthUri(RFC, "a@b.io")).toContain(`secret=${base32Encode(RFC)}`);
  });
});

describe("secret box (AUT-020)", () => {
  it("round-trips and binds to the AAD", () => {
    const { ciphertext, keyId } = sealSecret(ring(), RFC, totpAad("u1", "r1"));
    expect(openSecret(ring(), keyId, ciphertext, totpAad("u1", "r1")).equals(RFC)).toBe(true);
    expect(() => openSecret(ring(), keyId, ciphertext, totpAad("u2", "r1"))).toThrow(); // copied to another user's row
    expect(() => openSecret(ring(), keyId, ciphertext, totpAad("u1", "r2"))).toThrow();
  });
  it("detects tampering and still opens with an old key id after rotation", () => {
    const { ciphertext } = sealSecret(ring("old"), RFC, "a");
    const bad = Buffer.from(ciphertext); bad[14]! ^= 1;
    expect(() => openSecret(ring("old"), "old", bad, "a")).toThrow();
    const rotated = parseKeyRing(JSON.stringify({ old: Buffer.alloc(32, 7).toString("base64"), new: Buffer.alloc(32, 9).toString("base64") }), "new");
    expect(openSecret(rotated, "old", ciphertext, "a").equals(RFC)).toBe(true);
  });
  it("rejects a misconfigured ring", () => {
    expect(() => parseKeyRing(undefined, "k")).toThrow();
    expect(() => parseKeyRing(JSON.stringify({ k: "AAAA" }), "k")).toThrow();
    expect(() => parseKeyRing(JSON.stringify({ k: Buffer.alloc(32).toString("base64") }), "zz")).toThrow();
  });
});

describe("recovery codes", () => {
  it("are 60-bit, unique, well-formed and normalise ambiguous characters", () => {
    const codes = new Set(Array.from({ length: 200 }, generateRecoveryCode));
    expect(codes.size).toBe(200);
    for (const c of codes) { expect(c).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/); expect(isRecoveryCodeShape(c)).toBe(true); }
    expect(normalizeRecoveryCode("ab-io l0")).toBe("AB1010");
  });
  it("hash depends on the pepper and not on formatting", () => {
    const p1 = Buffer.alloc(32, 1), p2 = Buffer.alloc(32, 2);
    expect(hashRecoveryCode(p1, "abcd-efgh-jkmn")).toBe(hashRecoveryCode(p1, "ABCDEFGHJKMN"));
    expect(hashRecoveryCode(p1, "ABCDEFGHJKMN")).not.toBe(hashRecoveryCode(p2, "ABCDEFGHJKMN"));
    expect(hashRecoveryCode(p1, "ABCDEFGHJKMN")).toMatch(/^[0-9a-f]{64}$/);
  });
});
