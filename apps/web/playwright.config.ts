import { defineConfig, devices } from "@playwright/test";

// E2E runs against a real stack: MySQL (migrated + seeded), Redis, MinIO and the worker process.
// The web server is started from a production build (`pnpm build` first). See e2e/README.md.
const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // CI runs the visual specs in a dedicated step (baselines may not exist yet): E2E_SKIP_VISUAL=1 leaves them out of the main gate.
  testIgnore: process.env.E2E_SKIP_VISUAL ? /v3-08-visual\.spec\.ts/ : undefined,
  // Tests share one database. Every test creates its own users and reviews, so ordering does not matter.
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0, // a retry that passes is reported as "flaky", never silently green
  timeout: 120_000, // moderation runs in the worker: allow for queue + provider latency
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["junit", { outputFile: "test-results/junit.xml" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Gate: must stay green in CI.
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, grepInvert: /@quarantine/ },
    // Quarantined flaky tests (see e2e/QUARANTINE.md). Run and reported, but CI does not block on them.
    { name: "quarantine", use: { ...devices["Desktop Chrome"] }, grep: /@quarantine/ },
  ],
  webServer: {
    command: "pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
