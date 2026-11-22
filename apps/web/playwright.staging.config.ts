import { defineConfig, devices } from "@playwright/test";

// LIVE-07: runs specs against an already-running staging stack (scripts/staging-up.sh). No webServer is started.
const baseURL = process.env.STAGING_URL;
if (!baseURL) throw new Error("Set STAGING_URL to the staging base URL (e.g. http://<host>:3000)");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /live-walkthrough\.spec\.ts/,
  workers: 1,
  timeout: 180_000,
  reporter: [["list"], ["junit", { outputFile: "test-results/live-walkthrough-junit.xml" }]],
  use: { baseURL, ...devices["Desktop Chrome"], ignoreHTTPSErrors: false },
});
