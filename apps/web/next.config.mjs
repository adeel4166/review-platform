/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@rp/core", "@rp/db"],
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2"], // native addon, must not be bundled
};
