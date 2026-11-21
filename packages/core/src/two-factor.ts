/** 2FA primitives (m3b-spec 2.5-2.7, ADR-0019): RFC 6238 TOTP, AES-256-GCM secret box with AAD, recovery codes. Pure; no I/O. */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1; // +-1 step (M3b-Q14)
export const RECOVERY_CODE_COUNT = 10;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = (): Buffer => randomBytes(20);
export const totpStep = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/** HOTP (RFC 4226) truncated to 6 digits for a given counter. */
export function hotp(secret: Uint8Array, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Returns the matched step within the window, or null. Always evaluates every step (no early exit on the code). */
export function matchTotp(secret: Uint8Array, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(nowMs);
  let hit: number | null = null;
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    if (eq(hotp(secret, now + d), code) && hit === null) hit = now + d;
  }
  return hit;
}

export function otpauthUri(secret: Uint8Array, accountLabel: string, issuer = "Review Platform"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// ---- Secret box: iv(12) | ciphertext | tag(16), AAD binds the ciphertext to its row. ----

export interface KeyRing { active: string; keys: Record<string, Buffer> }

/** Parses `{"keyId":"base64-32-bytes"}` plus the active id. Throws on a malformed ring (fail closed). */
export function parseKeyRing(json: string | undefined, active: string | undefined, bytes = 32): KeyRing {
  if (!json || !active) throw new Error("key ring not configured");
  const raw = JSON.parse(json) as Record<string, string>;
  const keys: Record<string, Buffer> = {};
  for (const [id, b64] of Object.entries(raw)) {
    const k = Buffer.from(b64, "base64");
    if (k.length < bytes) throw new Error(`key ${id} must be at least ${bytes} bytes`);
    keys[id] = k.subarray(0, bytes);
  }
  if (!keys[active]) throw new Error("active key id missing from ring");
  return { active, keys };
}

export const totpAad = (userId: string, rowId: string) => `totp|${userId}|${rowId}`;

export function sealSecret(ring: KeyRing, plaintext: Uint8Array, aad: string): { ciphertext: Buffer; keyId: string } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", ring.keys[ring.active]!, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { ciphertext: Buffer.concat([iv, ct, c.getAuthTag()]), keyId: ring.active };
}

/** Throws when the key id is unknown, the AAD differs (ciphertext copied to another row) or the data was altered. */
export function openSecret(ring: KeyRing, keyId: string, sealed: Uint8Array, aad: string): Buffer {
  const key = ring.keys[keyId];
  if (!key || sealed.length < 12 + 16) throw new Error("cannot decrypt secret");
  const b = Buffer.from(sealed);
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(b.length - 16));
  return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]);
}

// ---- Recovery codes: 12 Crockford base32 chars (60 bits), HMAC-SHA-256 with a pepper held outside the database. ----

export function generateRecoveryCode(): string {
  const b = randomBytes(12);
  let s = "";
  for (const x of b) s += CROCKFORD[x & 31];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[-\s]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
}

export const isRecoveryCodeShape = (input: string): boolean => /^[0-9A-HJKMNP-TV-Z]{12}$/.test(normalizeRecoveryCode(input));

export function hashRecoveryCode(pepper: Uint8Array, input: string): string {
  return createHmac("sha256", pepper).update(normalizeRecoveryCode(input)).digest("hex");
}
