import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "design/**", "**/next-env.d.ts", "**/*.cjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly" } } },
);
