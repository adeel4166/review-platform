import { cloudinaryDeliveryUrl, createS3Store, loadEnv, mediaBuckets, type ObjectStore } from "@rp/core";

let cached: { store: ObjectStore; buckets: ReturnType<typeof mediaBuckets>; publicBaseUrl: string; publicUrlFor?: (key: string) => string } | undefined;

/** Lazily built from env only (credentials never hard-coded or logged). */
export function getStorage() {
  if (!cached) {
    const env = loadEnv();
    // The web app only builds URLs, so it gets the cloud name but never the Cloudinary API secret.
    const cloud = process.env.MEDIA_PUBLIC_STORE === "cloudinary" ? process.env.CLOUDINARY_CLOUD_NAME : undefined;
    cached = {
      store: createS3Store(env), buckets: mediaBuckets(env), publicBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL ?? "",
      // Cloudinary public tier: optimised (f_auto/q_auto) CDN URLs instead of the bucket URL.
      ...(cloud ? { publicUrlFor: (key: string) => cloudinaryDeliveryUrl(cloud, key) } : {}),
    };
  }
  return cached;
}
