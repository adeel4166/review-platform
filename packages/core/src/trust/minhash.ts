import { createHash } from "node:crypto";

export const MINHASH = { perms: 128, bands: 32, rows: 4, shingle: 3, threshold: 0.5 } as const;

/** SEC-M7-03: Cyrillic/Greek look-alikes and zero-width characters are folded before shingling so homoglyph rewrites do not evade matching. */
const HOMOGLYPHS: Record<string, string> = { а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", і: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d", ɡ: "g", α: "a", ο: "o", ρ: "p", ν: "v", ι: "i", κ: "k", τ: "t", υ: "u", χ: "x" };
const foldHomoglyphs = (t: string): string => t.replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "").replace(/./gu, (c) => HOMOGLYPHS[c] ?? c);
/** NEW/LOW authors are matched at a lower threshold than established authors. */
export const nearDuplicateThreshold = (band?: string): number => (band === "NEW" || band === "LOW" ? 0.4 : MINHASH.threshold);
export const normalise = (t: string): string => foldHomoglyphs(t.normalize("NFKC").toLowerCase()).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
export function shingles(text: string, k: number = MINHASH.shingle): Set<string> {
  const w = normalise(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (w.length === 0) return out;
  if (w.length < k) { out.add(w.join(" ")); return out; }
  for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(" "));
  return out;
}
const h32 = (s: string): number => createHash("sha256").update(s).digest().readUInt32BE(0);
// permutation i: (a_i * x + b_i) mod 2^32 with odd a_i derived deterministically
const A = Array.from({ length: MINHASH.perms }, (_, i) => (h32(`a${i}`) | 1) >>> 0);
const B = Array.from({ length: MINHASH.perms }, (_, i) => h32(`b${i}`));
export function minhash(text: string): Uint32Array {
  const sig = new Uint32Array(MINHASH.perms).fill(0xffffffff);
  for (const sh of shingles(text)) {
    const x = h32(sh);
    for (let i = 0; i < MINHASH.perms; i++) {
      const v = (Math.imul(A[i]!, x) + B[i]!) >>> 0;
      if (v < sig[i]!) sig[i] = v;
    }
  }
  return sig;
}
export const estimateJaccard = (a: Uint32Array, b: Uint32Array): number => {
  let eq = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) eq++;
  return eq / a.length;
};
/** LSH bucket keys: first 8 bytes (16 hex) of sha256 of each band's rows. */
export function lshBuckets(sig: Uint32Array): { band: number; bucket: string }[] {
  const out: { band: number; bucket: string }[] = [];
  for (let b = 0; b < MINHASH.bands; b++) {
    const rows = Array.from(sig.slice(b * MINHASH.rows, (b + 1) * MINHASH.rows)).join(",");
    out.push({ band: b, bucket: createHash("sha256").update(`${b}:${rows}`).digest("hex").slice(0, 16) });
  }
  return out;
}
export const toBytes = (sig: Uint32Array): Buffer => Buffer.from(sig.buffer, sig.byteOffset, sig.byteLength);
export const fromBytes = (b: Uint8Array): Uint32Array => new Uint32Array(Uint8Array.from(b).buffer);

export interface Fingerprint { reviewId: string; authorId: string; sig: Uint32Array }
/** In-memory index with the same semantics as review_lsh_buckets; the worker adapter queries the table instead. */
export class NearDuplicateIndex {
  private buckets = new Map<string, Set<string>>();
  private prints = new Map<string, Fingerprint>();
  add(f: Fingerprint) {
    this.prints.set(f.reviewId, f);
    for (const { band, bucket } of lshBuckets(f.sig)) {
      const k = `${band}:${bucket}`;
      (this.buckets.get(k) ?? this.buckets.set(k, new Set()).get(k)!).add(f.reviewId);
    }
  }
  /** Candidates by OTHER authors with estimated Jaccard >= threshold. */
  query(f: Fingerprint, threshold: number = MINHASH.threshold): { reviewId: string; authorId: string; jaccard: number }[] {
    const seen = new Set<string>(), out: { reviewId: string; authorId: string; jaccard: number }[] = [];
    for (const { band, bucket } of lshBuckets(f.sig)) {
      for (const id of this.buckets.get(`${band}:${bucket}`) ?? []) {
        if (seen.has(id) || id === f.reviewId) continue;
        seen.add(id);
        const p = this.prints.get(id)!;
        if (p.authorId === f.authorId) continue;
        const j = estimateJaccard(f.sig, p.sig);
        if (j >= threshold) out.push({ reviewId: id, authorId: p.authorId, jaccard: j });
      }
    }
    return out;
  }
}
