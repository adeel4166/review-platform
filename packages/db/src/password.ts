import { hash, verify } from "@node-rs/argon2";

// Argon2id (algorithm 2), OWASP minimums per ADR-0002: m >= 19 MiB, t >= 2, p = 1.
const OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
