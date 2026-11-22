# M8-02 staging smoke evidence

Status: **not yet green locally. To be confirmed by the CI jobs `staging-smoke`, `ops003`, `mysql-int` and `prod-config`** (artifact `staging-smoke`).

Run in the agent workspace (no Docker daemon, no MySQL, no deploy; no DEPLOY_STAGING proposal was requested):
- `pnpm lint`, `pnpm --filter @rp/worker typecheck`, `pnpm --filter @rp/core typecheck`: clean.
- `pnpm --filter @rp/worker exec vitest run m8-02 mysql-schema`: 4 passed (fail-closed startup, including the entrypoint exiting 1), 6 skipped (real-MySQL suite, needs `RP_INT_MYSQL=1`).
- `bash scripts/prod-config-check.sh`: 20/20 checks ok. `docker-compose.prod.yml`, `docker-compose.yml` and `ci.yml` parse as YAML.
- `next build` first failed with `UnhandledSchemeError: node:*` (edge compile of `instrumentation.ts`); fixed with `instrumentation-node.ts`. The re-run got past that error but did not finish inside the 10 minute tool limit (no database reachable here), so there is no local `preview-smoke` run. An earlier smoke attempt against a failed build returned HTTP 500; that is not evidence.

After CI runs, record here the run URL and the `smoke-evidence.txt` line (`SMOKE OK: 3 pages, N static assets all HTTP 200`).
