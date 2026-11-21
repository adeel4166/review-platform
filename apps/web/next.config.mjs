/** @type {import('next').NextConfig} */
export default {
  // Preview (`next start`) uses .next; `next dev` must use a different dir (NEXT_DIST_DIR=.next-dev) so artifacts never mix.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@rp/core", "@rp/db"],
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2"], // native addon, must not be bundled
};
