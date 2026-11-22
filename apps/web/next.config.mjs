/** Remote image hosts for next/image: the public media base URL and Cloudinary delivery (ADR-0034 D11). Local /placeholders SVGs bypass the optimiser. */
const remotePatterns = [];
try {
  const u = new URL(process.env.MEDIA_PUBLIC_BASE_URL ?? "");
  remotePatterns.push({ protocol: u.protocol.replace(":", ""), hostname: u.hostname, ...(u.port ? { port: u.port } : {}) });
} catch { /* unset in some environments */ }
remotePatterns.push({ protocol: "https", hostname: "res.cloudinary.com" });

/** @type {import('next').NextConfig} */
export default {
  // Preview (`next start`) uses .next; `next dev` must use a different dir (NEXT_DIST_DIR=.next-dev) so artifacts never mix.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@rp/core", "@rp/db"],
  images: { remotePatterns, formats: ["image/avif", "image/webp"] },
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2"], // native addon, must not be bundled
};
