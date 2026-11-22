import { createS3Store, loadEnv, mediaBuckets, type ObjectStore } from "@rp/core";

let cached: { store: ObjectStore; buckets: ReturnType<typeof mediaBuckets>; publicBaseUrl: string } | undefined;

/** Lazily built from env only (credentials never hard-coded or logged). */
export function getStorage() {
  if (!cached) {
    const env = loadEnv();
    cached = { store: createS3Store(env), buckets: mediaBuckets(env), publicBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL ?? "" };
  }
  return cached;
}
