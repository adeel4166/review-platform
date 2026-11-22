import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/.next-dev/**", "**/.next-build/**", "**/dist/**", "design/**", "**/next-env.d.ts", "**/*.cjs"] },
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
  {
    // CLK-001 / OPS-008 / ADR-0024: time comes from the injected Clock everywhere (error, no exemptions for production code).
    // Browser components only compute display-relative time; tests, fakes, e2e, seed and clock.ts own the real clock.
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.ts", "scripts/**/*.mjs"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/e2e/**", "apps/web/src/components/**", "**/*fake-db.ts", "**/media-store-fake.ts", "**/test-helpers.ts", "packages/db/prisma/seed.ts", "packages/core/src/clock.ts", "packages/core/src/testing/**"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Use the injected Clock (ADR-0024)." },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: "Use the injected Clock (ADR-0024)." },
      ],
    },
  },
  {
    // OPS-003: @rp/core/testing never reaches production code.
    files: ["packages/core/src/moderation/**/*.ts", "packages/core/src/ai/**/*.ts", "packages/core/src/approvals.ts", "packages/core/src/break-glass.ts", "packages/core/src/authz/**/*.ts", "packages/core/src/retention/**/*.ts", "apps/worker/src/moderation/**/*.ts", "apps/worker/src/maintenance/**/*.ts", "apps/worker/src/account/**/*.ts", "apps/worker/src/security/**/*.ts", "apps/web/src/server/{approvals,appeals,break-glass}.ts"],
    ignores: ["**/*.test.ts", "**/memory-store.ts", "**/test-config.ts", "**/test-ports.ts", "**/helpers.ts", "**/test-db.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@rp/core/testing", "**/testing/*"], message: "Test-only (CLK-001, OPS-003)." }] }],
    },
  },
  { files: ["**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly", URL: "readonly", Headers: "readonly", Request: "readonly", Response: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } } },
);
