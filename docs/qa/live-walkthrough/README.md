# Live walkthrough screenshots (LIVE-07)

**Status: NOT CAPTURED.** The agent workspace has no Docker daemon and no reachable staging host, so no screenshot exists here. None is fabricated.

Capture on a staging host after `scripts/staging-up.sh` (see `docs/ops/staging-runbook.md`):

```bash
STAGING_URL=http://<host>:3000 DEMO_PASSWORD=<from staging env file> \
  pnpm --filter @rp/web exec playwright install chromium
STAGING_URL=http://<host>:3000 DEMO_PASSWORD=<from staging env file> \
  pnpm --filter @rp/web exec playwright test -c playwright.staging.config.ts
```

Output: `<role>/<page>.<desktop|mobile>.png` (7 roles x pages x 2 viewports) plus `walkthrough-results.json` (status, final URL, console-error count per page).
The spec (`apps/web/e2e/live-walkthrough.spec.ts`) also fails on HTTP >= 400, on mobile horizontal overflow, and when a role is NOT refused on a page it must not open.
Commit the PNGs and the JSON, then fill the "Observed" column in `../live-gate-report.md`.
