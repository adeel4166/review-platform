import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "design/**", "**/next-env.d.ts", "**/*.cjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // ADR-0015: the SSRF-safe fetcher and raw HTTP clients are worker-only; the web app must never fetch user-influenced hosts.
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["**/verification/safe-fetch*", "@rp/worker*"], message: "The SSRF-safe fetcher is worker-only (ADR-0015)." },
      ], paths: ["node:http", "node:https", "http", "https", "undici", "node:dns", "node:dns/promises", "dns", "dns/promises"].map((name) => ({ name, message: "Outbound HTTP/DNS belongs in the verification worker (ADR-0015)." })) }],
    },
  },
  { files: ["**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly" } } },
);
