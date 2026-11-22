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
    // CLK-001 / ADR-0024: M6 modules take time from the injected Clock; @rp/core/testing never reaches production code.
    files: ["packages/core/src/moderation/**/*.ts", "packages/core/src/ai/**/*.ts", "packages/core/src/approvals.ts", "packages/core/src/break-glass.ts", "packages/core/src/authz/**/*.ts", "apps/worker/src/moderation/**/*.ts", "apps/worker/src/maintenance/**/*.ts", "apps/web/src/server/{approvals,appeals,break-glass}.ts"],
    ignores: ["**/*.test.ts", "**/memory-store.ts", "**/test-config.ts", "**/test-ports.ts", "**/helpers.ts"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Use the injected Clock (ADR-0024)." },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: "Use the injected Clock (ADR-0024)." },
      ],
      "no-restricted-imports": ["error", { patterns: [{ group: ["@rp/core/testing", "**/testing/*"], message: "Test-only (CLK-001, OPS-003)." }] }],
    },
  },
  { files: ["**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly", URL: "readonly", Headers: "readonly", Request: "readonly", Response: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } } },
);
