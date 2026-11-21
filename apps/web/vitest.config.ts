import { defineConfig } from "vitest/config";

// Next.js tsconfig uses "jsx": "preserve" (SWC/Next compiles it). Vitest needs the automatic runtime
// so the app's .tsx sources (layout, page) can be imported in node-environment smoke tests.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
