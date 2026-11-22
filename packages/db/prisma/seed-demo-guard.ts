/**
 * Demo-seed guards (LIVE-01). Kept free of any Prisma import so tests can load it without a database.
 * The demo seed creates accounts with a shared password and fake content: it must never run against production.
 */
export interface DemoEnv { NODE_ENV?: string; APP_ENV?: string; DEMO_PASSWORD?: string }

export class DemoSeedRefused extends Error {}

/** Throws (names only, never values) when the environment is production or the password is not provided via env. */
export function assertDemoSeedAllowed(env: DemoEnv): string {
  const prod = (v?: string) => (v ?? "").trim().toLowerCase() === "production";
  if (prod(env.NODE_ENV) || prod(env.APP_ENV)) throw new DemoSeedRefused("seed-demo refuses to run when NODE_ENV or APP_ENV is production");
  const pw = env.DEMO_PASSWORD;
  if (!pw || pw.length < 12) throw new DemoSeedRefused("DEMO_PASSWORD must be set in the environment (at least 12 characters); no default exists");
  return pw;
}
