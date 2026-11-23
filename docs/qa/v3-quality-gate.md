# v3 quality gate report (V3-08, re-gated in task #112 / V3-13)

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Branch / base** | `task/112` on main `f97d5fc` (V3-09..V3-12 merged) |
| **Budget source** | ADR-0034 D10 (`docs/qa/bundle-budget.json`) |
| **Rule** | PASS = zero open critical/high defects, or each one filed with an owner |

## Verdict (V3-13 re-gate): PASS on defects; browser/CI evidence UNVERIFIED

**Defect rule: PASS.** There are zero open critical/high defects. DEF-V3-01..-04, -06 and -07 are closed on main. DEF-V3-08 (INP gap) is closed by a new test that is authored but has not been run. The V3-11 security findings are fixed or owned as Low.

**Not yet observed.** This sandbox has no browser, MySQL, Redis or docker, and no CI run was available to me. I am recording no CI run ID because I have none to cite. The following are therefore **UNVERIFIED** until the CEO triggers CI and the artifacts are attached below:
- Playwright e2e, including the new INP spec.
- Axe, keyboard and reduced-motion passes.
- Visual baselines (none committed).
- Lighthouse LCP/CLS/TBT and the 120 KB image check.
- Live `IMG-1` (image fallback).

Until that run is green, treat the release gate as PASS-pending-CI, not PASS-verified.

## Re-gate evidence (observed in this sandbox, main `f97d5fc`)

| Check | Result |
|---|---|
| `pnpm lint` | PASS (0 errors; was 3) |
| `pnpm typecheck` | PASS (db, core, web, worker) |
| `pnpm test` | PASS: core 680, web 921 + 1 todo, worker 394 + 6 skipped (`mysql-schema.int`, needs MySQL) |
| `pnpm design:check` | PASS: tokens in sync, 212 contrast pairs pass in light and dark (lowest 3.05) |
| `pnpm --filter @rp/web build` | PASS |
| `node scripts/ops003-no-test-hooks.mjs apps/web/.next` | PASS, 682 files |
| `node scripts/bundle-budget.mjs` | PASS, every route, CSS and fonts within budget (table below) |
| Playwright e2e / visual / a11y / INP / Lighthouse | **UNVERIFIED** (no browser or stack here; CI jobs wired, see "CEO actions") |

### Budgets, before (V3-08) and after (V3-13 re-run)

| Item | V3-08 | Now | Budget | Result |
|---|---|---|---|---|
| `/` | 176 KB | 145.4 KB | 165 | ok |
| `/products/[slug]` | 210 KB | 155.7 KB | 165 | ok |
| `/products`, `/compare` | 157 | 126.6 | 165 | ok |
| `/sellers/[slug]`, `/u/[handle]`, `/trust/**` | 156, 125, 101 | 125.3, 125.1, 101.4 | 165 | ok |
| auth, contribute, account, staff (max) | 125, 149, 146, 149 | 124.7, 149.2, 146.7, 149.5 | 150, 190, 180, 250 | ok |
| global CSS | 11.4 KB | 11.5 KB | 35 | ok |
| preloaded fonts | 130.6 KB | 47.3 KB | 100 | ok |

The `/products/[slug]` first-load JS now has only 9.3 KB of headroom, so watch it on the next change.

## INP (DEF-V3-08)

New spec `apps/web/e2e/v3-13-inp.spec.ts`, budget **200 ms**, three scenarios:

| ID | Scenario |
|---|---|
| INP-1 | Product page: AI summary expand, button clicks, End key |
| INP-2 | Command palette: Ctrl+K open, typing, ArrowDown, Escape |
| INP-3 | Review form: rating, then typing in title and body |

- **Method:** a `PerformanceObserver` on the Event Timing API (`type: "event"`, `durationThreshold: 16`, `buffered: true`), which is the same source `web-vitals` reads. The spec adds no dependency, because `web-vitals` is not installed and I could not install packages here.
- **Assertion:** the worst interaction latency per scenario must be at most 200 ms. Each measured value is attached to the test annotations as `inp`.
- **CI:** the `e2e` job in `.github/workflows/ci.yml` has a new step "INP gate, 200 ms budget".
- **Status:** authored, typechecked and linted. **Not run, so no INP number is recorded.** Lab INP on shared CI runners is noisy. If INP-n flakes without a real regression, the owner should decide between retries and a looser lab budget. Do not silently quarantine it.

## Historical: V3-08 evidence (superseded by the re-gate above)

| Check | Result |
|---|---|
| `pnpm lint` | **FAIL at start**: 3 errors (DEF-V3-02, DEF-V3-03). `cn.test.ts` fixed in this task; 2 cloudinary errors remain (production source, reported) |
| `pnpm typecheck` | PASS (db, core, web, worker) |
| `pnpm test` | PASS: core 678, web 918 + 1 todo, worker 394 + 6 skipped (the skipped are `mysql-schema.int`, need MySQL) |
| `pnpm design:check` | PASS: tokens in sync, 212 contrast pairs pass in light + dark (lowest 3.05, non-text/large only) |
| `pnpm --filter @rp/web build` | **FAIL at start** (DEF-V3-01: lint error in `cn.test.ts` aborts `next build`); PASS after the test fix |
| `scripts/ops003-no-test-hooks.mjs apps/web/.next` | PASS, 677 files |
| `node scripts/bundle-budget.mjs` (new) | 3 FAIL, see below |
| jest-axe component suites (m3b/m4/m6/seller/admin-shell/ui-v2/v3-07, in `pnpm test`) | PASS (light/dark where the suite covers it) |
| Playwright e2e regression, integration (MySQL) | **UNVERIFIED** (no stack) |

### Budgets (ADR-0034 D10, gzip first-load JS)

| Route | Measured | Budget | Result |
|---|---|---|---|
| shared | 103 KB | 115 | ok |
| `/` | 176 KB | 165 | **FAIL (+11)** |
| `/products/[slug]` | 210 KB | 165 | **FAIL (+45)** |
| `/products`, `/compare`, `/sellers/[slug]`, `/u/[handle]`, `/trust/**` | 157, 157, 156, 125, 101 | 165 | ok |
| auth (`/login`, `/register`, `/verify-email`) | 123 to 125 | 150 | ok |
| contribute (review form, appeals, claims, sellers/new) | 121 to 149 | 190 | ok |
| account | 104 to 146 | 180 | ok |
| staff (`/admin/**`, `/seller/**`) | 101 to 149 | 250 | ok |
| global CSS | 11.4 KB | 35 | ok |
| preloaded fonts (`*.p.woff2`: 85.3 + 48.4 KB) | 130.6 KB | 100 | **FAIL (+31)** |

Note: `docs/qa/bundle-budget.json` and `scripts/bundle-budget.mjs`, promised by ADR D10 for V3-02, did not exist (DEF-V3-05); they are added here. The ADR 120 KB LCP-image budget and the LCP/CLS/TBT vitals need a browser (`scripts/lighthouse-gate.mjs`, new): **UNVERIFIED**. INP cannot be measured by a lab Lighthouse run; it needs field data or an interaction trace (open item DEF-V3-07).

## Tests added (not run here, no browser)

| File | Covers |
|---|---|
| `apps/web/e2e/v3-08-visual.spec.ts` | `toHaveScreenshot` for landing, products, product page, compare, review form, profile, 7 admin queues x light/dark x 375/1280 px, reduced motion, animations frozen, `time`/`[data-visual-mask]` masked. **Baselines must be generated on the CI image** (`--update-snapshots`) and eyeballed before merge |
| `apps/web/e2e/v3-08-a11y-gate.spec.ts` | axe (wcag2a/aa, 2.1, 2.2 AA, serious+critical blocking) on public routes, signed-in routes and admin queues in both themes; reduced-motion pass; keyboard-only passes (focus indicators, palette, product page, review form); image failure fallback; AI summary hidden/visible states |
| `scripts/bundle-budget.mjs`, `docs/qa/bundle-budget.json` | D10 route/CSS/font budgets, exit 1 on overrun (`--report` to not fail) |
| `scripts/lighthouse-gate.mjs` | mobile Lighthouse on `/`, `/products`, `/products/[slug]` against LCP 2.5 s, CLS 0.1, TBT 200 ms, 120 KB largest image |

`IMG-1` is expected to **fail** today (DEF-V3-04); do not mark it `fixme` until the owner decides.

## Defect log

| ID | Sev | Status | Owner | Defect | Reproduction |
|---|---|---|---|---|---|
| DEF-V3-01 | **Critical** | **Fixed in this task** (test file only) | QA / Frontend | `next build` of main failed: `apps/web/src/lib/cn.test.ts:8` `false && "x"` violates `no-constant-binary-expression`, and Next lints `src/`. Production build and deploy blocked | `git checkout b311502 && pnpm --filter @rp/web build` -> "Failed to compile ... cn.test.ts 8:28". Fix: non-constant operand. Rebuild passes |
| DEF-V3-02 | High | Fixed (task #108) | Backend (core) | `packages/core/src/cloudinary.ts:68` uses `Date.now()` in `signed()`, breaking ADR-0024 (inject Clock); also makes signing untestable deterministically. `pnpm lint` / `pnpm qa` red | `pnpm lint` -> `68:41 Use the injected Clock (ADR-0024)` |
| DEF-V3-03 | Low | Fixed (task #108) | Backend (core) | `cloudinary.ts:91` unused param `_h` (`@typescript-eslint/no-unused-vars`). Lint red together with DEF-V3-02 | `pnpm lint` -> `91:48` |
| DEF-V3-04 | High (UX) | **Closed** (task #109, `SafeImage`; live `IMG-1` UNVERIFIED, needs CI) | Frontend | `ProductThumb` (`apps/web/src/components/ui/ProductCard.tsx:24`) shows the letter fallback only when there is no image row. If the CDN image 404s/blocks, `<Image>` renders a broken-image icon in a `bg-bg-subtle` box; no `onError`. ADR D9/D11 require graceful fallback | DevTools: block `res.cloudinary.com` or `/_next/image*`, open `/products`: broken icons. Test `IMG-1` |
| DEF-V3-05 | Medium | **Closed** (budget gate wired into CI, task #111) | QA | `scripts/bundle-budget.mjs` and `docs/qa/bundle-budget.json` required by ADR D10 were never delivered, so budgets were unenforced; CI has no budget step | `ls scripts docs/qa/bundle-budget.json` on main. **Follow-up**: wire into CI after `pnpm build` (CI workflow edit is outside QA scope) |
| DEF-V3-06 | High | **Closed** (task #109; `/` 145.4 KB, `/products/[slug]` 155.7 KB, observed) | Frontend | Budget overruns: `/` 176 KB (+11), `/products/[slug]` 210 KB (+45) vs D10 165 KB. Likely charts / gallery / palette (`cmdk`) / `motion` not lazy on first load (ADR says gallery + `domMax` load on interaction) | `pnpm --filter @rp/web build && node scripts/bundle-budget.mjs`. Either lazy-load or ship an ADR-0034 amendment raising the number |
| DEF-V3-07 | High | **Closed** (task #109; preloaded fonts 47.3 KB, observed) | Frontend / Platform | Preloaded fonts 130.6 KB vs 100 KB budget (two preloaded woff2: 85.3 + 48.4 KB). Hurts LCP on mobile | `node scripts/bundle-budget.mjs` -> `FAIL preloaded fonts`. Reduce preloaded weights/subsets or amend the ADR |
| DEF-V3-08 | Medium | **Closed** (task #112, `v3-13-inp.spec.ts`; first CI run UNVERIFIED) | QA / Platform | No INP measurement exists anywhere (Lighthouse lab cannot produce it). Budget INP <= 200 ms is unenforced | Add `web-vitals` interaction trace in e2e or RUM. Not a code defect |
| DEF-V3-09 | Info | **Wired** (task #111) / **Open until CI run** | CEO / Platform | Gate environment has no browser/DB: e2e, visual, Lighthouse, live axe not executed (see verdict) | Need CI run of the `e2e` job + the new specs, then baselines committed |

Critical/high summary (V3-13): **zero open.** DEF-V3-01, -02, -04, -06 and -07 are closed. DEF-V3-03 (Low) is closed. DEF-V3-08 is closed. DEF-V3-09 stays open only until the first CI run is attached.

## V3-11 security findings (`docs/security/v3-security-review.md`)

| ID | Sev | Status |
|---|---|---|
| SEC-V3-01 (`/api/products` rate limit) | Medium | Fixed, test in `v3-security.test.ts` (in the passing web suite) |
| SEC-V3-02 (Cloudinary `remotePatterns` pinned to our cloud) | Medium | Fixed, same test |
| SEC-V3-03 (DailyCap per process) | Low | Fixed (V3-14) |
| SEC-V3-04 (summary payload exposes `model`/`generatedAt`) | Low | Open, accepted unless product objects |
| SEC-V3-05 (third-party names not stripped in summary input/output) | Low | Fixed (V3-14) |
| SEC-V3-06 (search LIKE-wildcard test) | Low | Fixed (V3-14) |
| SEC-V3-07 (Cloudinary strict transformations, SHA-1) | Low | Open, owner DevOps |

No medium or higher security finding is open. The remaining Low items are owned and do not block the gate.

## Not found (checked statically)

- Design contrast: all 212 pairs pass; no regression in token generation.
- Reduced motion: `MotionConfig reducedMotion="user"` in `Providers.tsx`; `ScrollRow` uses `auto` under reduce. Live verification is `A11Y-RM-1` (UNVERIFIED).
- AI summary card returns `null` for null/empty data and has `aria-expanded`/`aria-controls`; flag/READY gating is in `server/products.ts`. Live states: `AI-1`/`AI-2` (AI-2 skips until a READY summary is seeded).

## Reproduce

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm design:check
pnpm --filter @rp/web build && node scripts/bundle-budget.mjs
# on a stack with MySQL/Redis/MinIO/worker (see apps/web/e2e/README.md):
pnpm --filter @rp/web exec playwright install chromium
E2E_ADMIN_PASSWORD=... DATABASE_URL=... pnpm --filter @rp/web test:e2e                     # full regression + new axe gate
pnpm --filter @rp/web test:e2e -- v3-08-visual --update-snapshots                            # once, then review PNGs
BASE_URL=http://localhost:3000 node scripts/lighthouse-gate.mjs
pnpm --filter @rp/web exec playwright test --project=chromium v3-13-inp                     # INP 200 ms budget
```

## CEO actions (what only you can click)

1. **Push `task/112` and the merged `main` to GitHub.** CI does not run until the code is on GitHub.
2. **Run the CI workflow** and open the run. Record its URL and attach artifacts here:
   - the `e2e` job (regression, a11y gate, **INP gate**), with artifact `e2e-report`;
   - the `lighthouse` job, with artifact `lighthouse-report`;
   - the `ci` job (this re-gate already passes locally, so it should be green).
3. **Generate visual baselines.** Run the manual `visual-baselines` job (`workflow_dispatch`) and download the PNG artifact.
4. **Approve the baselines.** Eyeball the PNGs for landing, products, product page, compare, review form, profile and the 7 admin queues, in light and dark at 375 and 1280 px. Commit them to `apps/web/e2e/v3-08-visual.spec.ts-snapshots/`. Until they are committed the visual step only warns.
5. **Fill in the observed values** for INP, Lighthouse, e2e and axe from those artifacts, or send the results back to QA to record. Until then those rows stay UNVERIFIED.
6. **Ops items.** Optionally assign SEC-V3-03..07 owners to tickets, and enable Cloudinary strict transformations (SEC-V3-07).
