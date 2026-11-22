# v3 quality gate report (task #107, V3-08)

| | |
|---|---|
| **Owner** | QA Engineer (QA_SECURITY) |
| **Branch / base** | `task/107`, main at `b311502` (V3-07 merged) |
| **Budget source** | ADR-0034 D10 (`docs/qa/bundle-budget.json`) |
| **Rule** | PASS = zero open critical/high defects, or each one filed with an owner |

## Verdict: FAIL (conditional), 3 high defects open with owners, browser-based evidence UNVERIFIED

The sandbox that ran this gate has **no browser, no MySQL, no Redis and no docker** (`~/.cache/ms-playwright` absent, `mysqladmin ping` refused, docker socket denied). Everything that can run without them was run and is recorded below as observed. Everything that needs them (Playwright e2e regression, visual snapshots, Lighthouse, live axe/reduced-motion/keyboard passes, image-fallback and AI-summary live states) is **authored and committed but UNVERIFIED**; I do not record an unobserved result as PASS. First action for the reviewer: run the CI `e2e` job plus the commands in "Reproduce".

## Evidence run in this sandbox

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
| DEF-V3-02 | High | Open | Backend (core) | `packages/core/src/cloudinary.ts:68` uses `Date.now()` in `signed()`, breaking ADR-0024 (inject Clock); also makes signing untestable deterministically. `pnpm lint` / `pnpm qa` red | `pnpm lint` -> `68:41 Use the injected Clock (ADR-0024)` |
| DEF-V3-03 | Low | Open | Backend (core) | `cloudinary.ts:91` unused param `_h` (`@typescript-eslint/no-unused-vars`). Lint red together with DEF-V3-02 | `pnpm lint` -> `91:48` |
| DEF-V3-04 | High (UX) | Open | Frontend | `ProductThumb` (`apps/web/src/components/ui/ProductCard.tsx:24`) shows the letter fallback only when there is no image row. If the CDN image 404s/blocks, `<Image>` renders a broken-image icon in a `bg-bg-subtle` box; no `onError`. ADR D9/D11 require graceful fallback | DevTools: block `res.cloudinary.com` or `/_next/image*`, open `/products`: broken icons. Test `IMG-1` |
| DEF-V3-05 | Medium | Fixed in this task (tooling) | QA | `scripts/bundle-budget.mjs` and `docs/qa/bundle-budget.json` required by ADR D10 were never delivered, so budgets were unenforced; CI has no budget step | `ls scripts docs/qa/bundle-budget.json` on main. **Follow-up**: wire into CI after `pnpm build` (CI workflow edit is outside QA scope) |
| DEF-V3-06 | High | Open | Frontend | Budget overruns: `/` 176 KB (+11), `/products/[slug]` 210 KB (+45) vs D10 165 KB. Likely charts / gallery / palette (`cmdk`) / `motion` not lazy on first load (ADR says gallery + `domMax` load on interaction) | `pnpm --filter @rp/web build && node scripts/bundle-budget.mjs`. Either lazy-load or ship an ADR-0034 amendment raising the number |
| DEF-V3-07 | High | Open | Frontend / Platform | Preloaded fonts 130.6 KB vs 100 KB budget (two preloaded woff2: 85.3 + 48.4 KB). Hurts LCP on mobile | `node scripts/bundle-budget.mjs` -> `FAIL preloaded fonts`. Reduce preloaded weights/subsets or amend the ADR |
| DEF-V3-08 | Medium | Open (gap) | QA / Platform | No INP measurement exists anywhere (Lighthouse lab cannot produce it). Budget INP <= 200 ms is unenforced | Add `web-vitals` interaction trace in e2e or RUM. Not a code defect |
| DEF-V3-09 | Info | Open | CEO / Platform | Gate environment has no browser/DB: e2e, visual, Lighthouse, live axe not executed (see verdict) | Need CI run of the `e2e` job + the new specs, then baselines committed |

Critical/high summary: DEF-V3-01 fixed; DEF-V3-02, -04, -06, -07 are **open high, each with an owner above**. Per the acceptance rule the gate is satisfied only conditionally; closing it requires owners to fix or amend ADR-0034, and the browser-based runs to be executed.

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
```
