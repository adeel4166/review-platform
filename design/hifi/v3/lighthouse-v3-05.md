# V3-05 Lighthouse / axe report

Status: **not run in the authoring environment** (no database, object store, or long-running server is allowed there).
Run against a production build with the seeded database:

```
pnpm infra:up && pnpm db:push && pnpm db:seed:demo
pnpm --filter @rp/web build && pnpm --filter @rp/web start &
npx lighthouse http://localhost:3000/ --only-categories=performance,accessibility --preset=desktop
npx lighthouse http://localhost:3000/products/acme-noise-cancelling-headphones --only-categories=performance,accessibility
pnpm --filter @rp/web test:e2e -- v3-landing-catalog.spec.ts   # axe, 360px, light + dark
```
Targets: performance >= 90 and accessibility >= 90 on both pages. Attach the HTML reports here.

Performance design notes: hero LCP is text (no image blocking); the product-page gallery's first image uses `priority` + `sizes`;
all image boxes have fixed aspect ratios (no CLS); motion code is lazy-loaded (`LazyMotion`).
