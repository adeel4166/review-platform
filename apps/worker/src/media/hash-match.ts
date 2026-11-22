import sharp from "sharp";

/**
 * MED-036 hash-match hook (m4-m5-spec 8.1 step 7). `check` receives the exact sha256 of the original and, once variants
 * exist, a 64-bit perceptual hash of the `medium` variant. A real provider (L-17) plugs in here; CI and dev use the
 * `BannedMediaHash` stub below. A match -> REJECTED (BANNED_HASH), original kept under legal hold, security alert.
 */
export interface HashMatcher {
  check(input: { sha256: string; pHash?: string }): Promise<{ match: boolean; list?: string }>;
}

/** Stub: exact sha256 against `BannedMediaHash`. pHash is accepted and ignored (no perceptual list in the stub). */
export const bannedHashMatcher = (db: { bannedMediaHash?: { findUnique(args: unknown): Promise<unknown | null> } }): HashMatcher => ({
  async check({ sha256 }) {
    const hit = await db.bannedMediaHash?.findUnique({ where: { sha256 } });
    return hit ? { match: true, list: "BannedMediaHash" } : { match: false };
  },
});

/** 64-bit difference hash (dHash) as 16 hex chars, computed from pixel data only. */
export async function perceptualHash(image: Buffer): Promise<string> {
  const { data } = await sharp(image).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (data[y * 9 + x]! > data[y * 9 + x + 1]! ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export const hammingDistance = (a: string, b: string): number => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0;
  for (; x; x &= x - 1n) n++;
  return n;
};
