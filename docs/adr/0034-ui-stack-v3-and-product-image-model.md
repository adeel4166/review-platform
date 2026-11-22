# ADR-0034: UI stack v3 (Tailwind v4, shadcn/ui, Motion, themes) and the product image and AI review summary data models

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (proposer), CEO (approver) |
| **Task** | #100 (V3-01), plan #16 "Review Platform v3" |
| **Related** | Supersedes the LIVE-02 **"No new dependencies"** rule in [`design/hifi/README.md`](../../design/hifi/README.md). Builds on ADR-0001 (stack), ADR-0003 (permissions), ADR-0004/0010 (data model and naming), ADR-0006/0012/0023 (media pipeline and publication gate), ADR-0007/0013 (worker and outbox), ADR-0009 (i18n), ADR-0028 (AI contract), ADR-0033 (erasure) |

This ADR covers several connected decisions. Plan #16 asked for a single contract that the V3 tasks can follow. Each decision has its own number (**D1…D12**) so later ADRs can amend or supersede one of them on its own.

## Context

1. **The hi-fi v2 specs (LIVE-02) ban new dependencies.** They allow only inline SVG icons and the v3 Tailwind preset. That kept the launch small. Phase 1 v3 now needs a professional UI: accessible overlays (dialog, popover, sheet, tabs, combobox), a consistent icon set, motion, a dark/light toggle, real product photos and AI summaries. Hand-building accessible overlay primitives costs more and carries more a11y risk than adopting audited ones.
2. **Current baseline** (`apps/web/package.json`, `pnpm-lock.yaml`): `next@15.5.29`, `react@19.3.1`, `tailwindcss@3.4.19` plus `autoprefixer`, and `design/tailwind-preset.cjs`, which `design/gen.cjs` generates from `design/tokens.json`. `pnpm design:check` fails when the generated output drifts. Dark mode is token-driven: `design/tokens.css` has `:root[data-theme="dark"]` and a `prefers-color-scheme` fallback, and the preset sets `darkMode: ['selector','[data-theme="dark"]']`. A global `prefers-reduced-motion` clamp already exists in `tokens.css`.
3. **The CSP is strict** (`apps/web/src/server/security-headers.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`. `img-src` and `media-src` add `https://res.cloudinary.com` only when `MEDIA_PUBLIC_STORE=cloudinary`. Any new library that injects scripts must accept the nonce.
4. **Public media** goes through `routePublicBucket` (`packages/core/src/cloudinary.ts`). With `MEDIA_PUBLIC_STORE=cloudinary`, the public bucket is stored on Cloudinary and the web app builds `f_auto,q_auto` delivery URLs with `cloudinaryDeliveryUrl`. Otherwise it uses MinIO/S3 and `MEDIA_PUBLIC_BASE_URL`. MinIO is the default and is used in dev, CI and the prod compose files. Public keys are `publicKey(assetId, name)` = `m/<assetId>/<name>`, with variants `thumb.webp` (≤ 400 px) and `medium.webp` (≤ 1600 px). The database gate `chk_media_public_bucket` (MED-037, ADR-0023) blocks any public object that has not been scanned, stripped and cleared by moderation.
5. **Products have no images.** `ProductCard` shows a category glyph placeholder. `MediaAsset.reviewId` is `NOT NULL`, so the pipeline only knows about review media.
6. **AI** goes through one provider abstraction (`packages/core/src/ai/*`, `moderation-provider.ts`). That covers Gemini, `ProviderCall`, `Breaker`, `DailyCap` and the pinned system-prompt SHA-256. It is used only for moderation verdicts (ADR-0028).
7. **No performance budget exists**, so "add a dependency" has no measurable cost ceiling.

## Decision

### D1. The "no new dependencies" rule is replaced by an allow-list

The LIVE-02 rule is **superseded**. From now on, `apps/web` may add a runtime or build dependency only if **one** of these holds:

- it is on the D2 allow-list, at the version listed there, or
- a later ADR adds it.

Any version change to an allow-listed package is a normal PR that must pass the D10 budgets. A major-version bump needs an ADR amendment. Inline SVG icons that were already built stay valid until a screen is migrated. New screens use `lucide-react` (D5).

### D2. Approved packages and pinned versions

Versions were checked against the npm registry on 2026-11-22. They are written as **exact versions** in `package.json` (no `^`), so a lockfile refresh cannot bring in an unreviewed minor version. Existing caret ranges are not changed by this ADR.

| Concern | Package | Version | Where | License | Notes |
|---|---|---|---|---|---|
| CSS engine | `tailwindcss` | **4.3.5** | `apps/web` devDep | MIT | replaces 3.4.19 (D3) |
| PostCSS plugin | `@tailwindcss/postcss` | **4.3.5** | `apps/web` devDep | MIT | must equal `tailwindcss`. `autoprefixer` is **removed** (v4 prefixes with Lightning CSS) |
| Overlay animations | `tw-animate-css` | **1.4.0** | `apps/web` devDep | MIT | CSS only, 0 B JS. Provides the `animate-in`/`fade-*` classes that shadcn components use |
| Primitives | `radix-ui` | **1.8.1** | `apps/web` dep | MIT | unified Radix package that shadcn uses. Import per primitive (`import { Dialog } from "radix-ui"`); it tree-shakes |
| Component recipes | `shadcn` (CLI) | **4.23.0** | **not installed**; run as `pnpm dlx shadcn@4.23.0 add …` | MIT | shadcn/ui copies source into the repo. Generated code is owned and reviewed like any other code (D4) |
| Variant helpers | `class-variance-authority` | **0.7.1** | dep | Apache-2.0 | used by shadcn recipes |
| | `clsx` | **2.1.1** | dep | MIT | |
| | `tailwind-merge` | **3.7.1** | dep | MIT | 3.x is the Tailwind v4 line. Configure it with `extendTailwindMerge` for our token names (`shadow-*`, `rounded-*`, `text-text*`, `bg-bg*`) |
| Motion | `motion` | **14.14.0** | dep | MIT | successor to `framer-motion`. Import **only** from `motion/react` through `LazyMotion` (D6). `framer-motion` is banned |
| Icons | `lucide-react` | **1.77.0** | dep | ISC | named imports only. Next 15 already lists it in `optimizePackageImports` |
| Theme | `next-themes` | **0.4.6** | dep | MIT | D7 |
| Font | `next/font/google` (Inter) | ships with `next@15.5.29` | — | OFL-1.1 (font) | D8. Fonts are self-hosted at build time, with no runtime request to Google |
| Images | `next/image` | ships with `next@15.5.29` | — | — | D9, with a custom loader |
| Page transitions | View Transitions API | browser API | — | — | D6. No package (`next-view-transitions` is rejected) |
| Analysis (optional) | `@next/bundle-analyzer` | **15.5.29** | root devDep | MIT | version must equal `next`. Used by D10 investigations only |

**Framework versions stay as they are:** `next@15.5.29` and `react@19.3.1`. Next 16 is out (16.4.6) but is **not** part of v3. Moving to it renames `middleware` to `proxy`, changes the Turbopack and build output, and needs `next-auth@5 beta` compatibility work. That gets its own ADR after the v3 quality gate.

**Browser baseline.** v3 targets Safari/iOS ≥ 16.4, Chrome/Edge ≥ 111 and Firefox ≥ 128. This is Tailwind v4's floor, because v4 relies on cascade layers, `@property` and `color-mix()`. Older browsers get unsupported, possibly unstyled output. Server-rendered content stays readable, because content does not depend on JS.

### D3. Tailwind v3 → v4 migration path (keeps `design/` as the source of truth)

`design/tokens.json` stays the **single source**. `design/gen.cjs` keeps generating everything, and `pnpm design:check` keeps failing on drift. The migration happens in two steps, so the engine swap is never mixed with a token rewrite.

**Step A: engine swap, no visual change (V3-02).**

1. Swap the dependencies as in D2. `postcss.config.cjs` becomes `{ plugins: { "@tailwindcss/postcss": {} } }`.
2. In `globals.css`, replace `@tailwind base/components/utilities` with `@import "tailwindcss";`. Keep `@import "…/design/tokens.css"` **before** it. Load the existing JS config through the compatibility directive: `@config "../../tailwind.config.cjs";`. That config keeps `presets: [require("../../design/tailwind-preset.cjs")]`. Remove `content` (v4 detects sources automatically) and add `@source "../";` only if a path is missed.
3. Dark variant: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`. This equals today's selector strategy.
4. Fix the v4 default changes by hand. Do **not** run the `@tailwindcss/upgrade` class rewrite blindly: it renames `shadow-sm`→`shadow-xs` and `rounded-sm`→`rounded-xs`, but our preset **overrides** `sm…2xl` with token values, so those renames would point at the wrong tokens. The checklist:
   - `border` with no colour now uses `currentColor`. Add `border-border` where a colour is missing.
   - bare `ring` is now 1 px. Use explicit `ring-2` plus `ring-focus`.
   - `outline-none` → `outline-hidden`.
   - Buttons no longer get `cursor: pointer`. Add a base rule in `globals.css`.
   - Placeholder colour moves to `placeholder:text-text-muted`.
   - Variant stacking order changes (v4 applies variants left to right).
   - `hover:` only applies on `(hover: hover)` devices.
   - Arbitrary CSS-variable syntax changes from `x-[--v]` to `x-(--v)`.
   - The `!` important modifier becomes a suffix.
   - Bare `rounded`, `shadow` and `border` (no suffix) are banned in new code and replaced with token sizes.
5. Gate: `pnpm qa` passes, the existing a11y tests pass, and Playwright screenshots of the D10 routes in light and dark mode match the v3 build within a 0.1 % pixel threshold.

**Step B: CSS-first theme (same task if Step A is small, otherwise V3-03).**

1. `gen.cjs` additionally emits `design/tailwind-theme.css`:
   - an `@theme { … }` block whose variable names equal the `tokens.css` names (`--color-bg`, `--radius-md`, `--breakpoint-md`, …), holding the **light** values;
   - `@utility` rules for the non-namespaced helpers (`min-h-target`, `min-w-target`, `max-w-content`, `max-w-reading`).

   The unlayered `tokens.css` overrides (`[data-theme=dark]`, `prefers-color-scheme`) win over Tailwind's `@layer theme`, so runtime theme switching keeps working. Shadows and elevation must resolve to `var(--shadow-*)`, because they differ per theme. If `@theme` would inline the shadow value, the generator emits `--shadow-*: initial;` plus `@utility shadow-sm { box-shadow: var(--shadow-sm) }` (and so on) instead.
2. `globals.css` replaces `@config` with `@import "../../../../design/tailwind-theme.css";`. Then `tailwind-preset.cjs` and `apps/web/tailwind.config.cjs` are deleted. `design:check` diffs `tailwind-theme.css` instead of the preset.
3. Gate: a Vitest snapshot of the compiled CSS for a fixture proves two things: every token utility resolves to `var(--<token>)`, and toggling `data-theme` changes the computed colour and shadow. Plus the Step A screenshot gate.

Default Tailwind palettes stay available, the same as v3 `extend`. Product code may use **only semantic tokens**. Raw palette classes such as `bg-gray-100` or `text-blue-600` are flagged by an ESLint rule or grep added in V3-08.

### D4. shadcn/ui on Radix: where the code lives and who owns it

- `apps/web/components.json`: `style: "new-york"`, `rsc: true`, `tsx: true`, `iconLibrary: "lucide"`, `tailwind.css: "src/app/globals.css"`, `tailwind.cssVariables: true`, alias `ui` → `@/components/ui/primitives`, alias `utils` → `@/lib/cn`.
- Generated primitives go to `apps/web/src/components/ui/primitives/` with lowercase file names (`dialog.tsx`). The existing PascalCase app components in `components/ui/` (`Badge`, `Avatar`, `Skeleton`, `Toast`, `EmptyState`, `ProductCard`, `RatingHistogram`) keep their public API and are re-implemented on top of the primitives. Keeping the two in separate folders avoids `Badge.tsx`/`badge.tsx` clashes on case-insensitive file systems.
- **Theme mapping:** shadcn's own CSS variables (`--background`, `--primary`, …) are **not** added. After generation, recipes are edited to use our tokens (`bg-surface`, `text-text`, `border-border`, `ring-focus`, `bg-primary text-on-primary`). One token system keeps the contrast checks (`check-contrast.cjs`) valid.
- **Approved first set:** dialog, sheet, popover, dropdown-menu, tooltip, tabs, accordion, select, checkbox, radio-group, switch, label, separator, scroll-area, toggle-group, command (combobox only if its size fits the D10 budget).
- **Not adopted:**
  - `sonner` (toasts): the existing a11y-tested `ToastProvider` stays.
  - `form` plus `react-hook-form`: server actions and zod stay as they are.
  - `chart`/`recharts`: the histogram stays CSS.
  - `carousel`/`embla`: the gallery is built on Radix plus native scroll-snap (D9).
- Client boundary: primitives are `"use client"` leaves. Pages and layouts stay server components. Never pass functions from server to client props.

### D5. Icons

`lucide-react@1.77.0` with named imports only. Default `size={20}`, `strokeWidth={1.5}` (this matches `placeholder-stroke`), and `aria-hidden="true"` unless the icon is the only label. Icon-only buttons need an `aria-label` from `t()`. Lucide's own `name` props are not used for dynamic icon lookup, because that pulls in the whole icon set.

### D6. Motion, View Transitions and the reduced-motion policy

**Motion (`motion@14.14.0`).**

- The root client provider wraps the app in `<MotionConfig reducedMotion="user"><LazyMotion features={() => import("@/lib/motion-features").then(m => m.default)} strict>`, where `motion-features` re-exports `domAnimation`. Components use `m.*`, never `motion.*` (`strict` makes `motion.*` throw). This keeps the motion runtime out of first-load JS. The feature bundle loads asynchronously after hydration. `domMax` (layout and drag) is allowed only in the gallery/lightbox chunk.
- Use CSS transitions or `tw-animate-css` by default (hover, focus, Radix open/close through `data-state`). Use Motion only for **exit** animations, gestures (swipe in the lightbox) or shared-layout effects.
- Durations come from tokens: fast 120 ms, base 200 ms, slow 320 ms, and nothing longer than 400 ms. Missing duration or easing tokens are added through `gen.cjs`. No looping animation, except loading indicators that are replaced after 5 s.

**View Transitions API** (no package, progressive enhancement).

- Cross-document: `@view-transition { navigation: auto; }` in `globals.css` (affects full-page navigations only).
- Same-document: a small client helper `startViewTransitionNav(router, href)`. It calls `document.startViewTransition()` only if that exists and reduced motion is off, and resolves the callback after `usePathname()` changes, with a 1 s timeout so navigation is never blocked. It is used only on product card → product page (shared `view-transition-name: product-<id>` on the primary image) and compare add/remove.
- `view-transition-name`s are unique per page and set only on the elements being transitioned.
- Rejected for now: Next's `experimental.viewTransition` together with React's `<ViewTransition>`. It is still experimental on Next 15.5, so we revisit it with the Next 16 ADR.

**Reduced-motion policy** (applies to every v3 task):

1. **The OS setting is authoritative.** We honour `prefers-reduced-motion: reduce`. There is no separate in-app toggle in v3 (possible follow-up).
2. **CSS:** the existing global clamp in `tokens.css` stays. In addition, under `reduce`, `::view-transition-group(*)`, `::view-transition-old(*)` and `::view-transition-new(*)` get `animation: none !important`.
3. **Motion:** with `MotionConfig reducedMotion="user"`, transform and layout animations are skipped. Opacity fades of ≤ 120 ms may stay. Components must not override `reducedMotion`.
4. **View transitions:** the helper skips `startViewTransition` entirely under `reduce`.
5. **Banned in all modes:** autoplaying video or carousels, parallax, scroll-jacking, `scroll-behavior: smooth` on `html`, flashing more than 3 times per second (WCAG 2.3.1), and motion that lasts more than 5 s without a pause control (WCAG 2.2.2).
6. **Parity:** motion never carries information on its own. Every animated change of state also has a text or ARIA change, such as the lightbox counter "3 of 8", `aria-live` toasts and `aria-pressed` votes.
7. **Tests (V3-08):** a Playwright project with `reducedMotion: "reduce"` runs the D10 routes and asserts three things: no running animations longer than 0.01 ms (`document.getAnimations()`), no `startViewTransition` calls (spy), and the axe checks pass. A unit test asserts that the root provider sets `reducedMotion="user"`.

### D7. Dark/light theme with `next-themes@0.4.6`

- `<ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem themes={["light","dark"]} disableTransitionOnChange nonce={nonce}>` in the root layout. `nonce` is read from the `x-nonce` request header that `middleware.ts` already sets. **It is required:** next-themes injects an inline no-flash script, and `script-src` with `'strict-dynamic'` blocks that script without the nonce. `<html suppressHydrationWarning>`.
- next-themes writes the *resolved* `light`/`dark` value to `data-theme`, so the `dark:` variant (D3) and the token overrides agree. The `prefers-color-scheme` block in `tokens.css` stays as the no-JS fallback.
- The preference is stored in `localStorage` only (key `rp-theme`). It is not stored in a cookie or the database, because reading cookies in the root layout would make every page dynamic, and a theme is not account data. The toggle is a 3-state segmented control (System, Light, Dark) in the header user menu and footer, labelled through `t()`.
- `pnpm design:check` contrast checks must pass for **both** themes on every new token.

### D8. Font: Inter through `next/font/google`

- `Inter({ subsets: ["latin","latin-ext"], display: "swap", variable: "--font-inter", adjustFontFallback: true })`. The variable font is a single file. `tokens.json` changes `font-family-sans` to `var(--font-inter), ui-sans-serif, system-ui, …`. Mono stays the system stack, so no mono font is downloaded.
- Why Inter and not Geist: the tokens and hi-fi specs are already set in Inter, so there is no brand change and no re-check of line lengths. Inter also covers Latin Extended, Cyrillic, Greek and Vietnamese, which matters for i18n readiness (ADR-0009). Further subsets are added per locale only when that locale ships.
- Files are downloaded at **build time** and served from `/_next/static/media` (`font-src 'self'` already allows that). The build therefore needs network access to `fonts.gstatic.com`. CI and the Docker build already have it for `pnpm install`. If offline builds become a requirement, switch to `next/font/local` with the same OFL files committed under `apps/web/src/fonts/`. That would be an amendment, not a new ADR.
- Budget: total preloaded font size ≤ 100 KB (woff2), counted inside D10.

### D9. `next/image` with Cloudinary `remotePatterns` and a custom loader

- `next.config.mjs` contains this configuration:

  ```js
  images: {
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    deviceSizes: [640, 828, 1080, 1600],
    imageSizes: [96, 160, 320, 480],
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com", pathname: "/*/image/upload/**" }],
  }
  ```

  The built-in `/_next/image` optimizer is **not used anywhere**. That means no `sharp` CPU or cache disk on the VPS, no server-side fetch of media URLs, and Cloudinary's CDN stays the edge.
- **The loader works per URL at runtime.** It must not read env, because it runs in the client bundle, so a single build serves both stores:
  - `https://res.cloudinary.com/<cloud>/image/upload/<tx>/<publicId>.<ext>`: replace `<tx>` with `f_auto,q_auto,c_limit,w_<w>`. `w` snaps to the next value in `deviceSizes ∪ imageSizes` (8 widths), which bounds Cloudinary derived assets and credits. `c_limit` never upscales.
  - our own public URLs on MinIO/S3 (`…/m/<id>/medium.webp`): when `w ≤ 480`, return the sibling `…/thumb.webp`; otherwise return `medium.webp` unchanged. The pipeline already produced those variants (ADR-0012).
  - anything else, for example `/public` assets: return `src` unchanged.
- `remotePatterns` is the declared allow-list. Because the loader is custom, the actual enforcement points are the loader's host check, which returns `src` unmodified for unknown hosts and logs a dev warning, and the CSP `img-src` that is already in place.
- Every `<Image>` passes `width`/`height` from the data (D11), so there is no CLS. Hero/LCP images get `priority`. Everything else is lazy. `sizes` is required on responsive images. `placeholder` is `"empty"` with the `dominantColor` (D11) as the background.
- Ops follow-up: enable Cloudinary **strict transformations** and allow-list exactly the 8 width transformations plus the existing `f_auto,q_auto` and `q_auto,vc_auto`, so third parties cannot mint new derivatives on our account.

### D10. Performance and bundle budget

The metric is **first-load JS per route, gzip**, as `next build` reports it on Next 15 ("First Load JS" = shared chunks plus route chunks). V3-02 adds `scripts/bundle-budget.mjs`. It runs after `next build`, reads `.next/app-build-manifest.json`, gzips the listed chunks, compares them with `docs/qa/bundle-budget.json`, and fails CI on overrun. It runs in `pnpm qa:build` and CI. The baseline from v3.0 (Tailwind v4 swap only) is recorded in the same JSON file in V3-02.

| Route group | Routes | First-load JS budget (gzip) |
|---|---|---|
| Shared (all routes) | framework + layout + providers (theme, toast, LazyMotion shell) | **≤ 115 KB** |
| Public read | `/`, `/products`, `/products/[slug]`, `/compare`, `/u/[handle]`, `/sellers/[slug]`, `/trust/**` | **≤ 165 KB** |
| Product page interactive extras | gallery/lightbox, `domMax`; loaded **on interaction**, not first load | ≤ 45 KB async chunk |
| Auth | `/login`, `/register`, `/verify-email` | ≤ 150 KB |
| Contribute | `/products/[slug]/review`, `/sellers/new`, `/appeals`, `/claims` | ≤ 190 KB |
| Account | `/account/**`, `/decisions`, `/invitations`, `/ownership-transfers` | ≤ 180 KB |
| Staff | `/admin/**`, `/seller/**` | ≤ 250 KB |

The other budgets are enforced in V3-08 through Lighthouse CI (mobile profile) on `/`, `/products` and `/products/[slug]`:

- CSS: global stylesheet ≤ 35 KB gzip.
- Fonts: ≤ 100 KB preloaded.
- LCP image: ≤ 120 KB transferred at 828 w.
- Web vitals targets: LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms, TBT ≤ 200 ms.

Overrun rule: a PR that exceeds a budget either brings the route back under it or carries an ADR amendment that raises the number with a reason.

### D11. Product image data model

Product images **reuse the existing media pipeline and the publication gate**. They get no second upload path. `MediaAsset` keeps owning the bytes: ingest, scan, sanitise, variants, moderation, promotion, demotion, the deletion ledger. A new `ProductImage` row holds the per-product presentation.

**`MediaAsset` changes:**

- New enum `MediaPurpose { REVIEW, PRODUCT_IMAGE }`, with column `purpose MediaPurpose @default(REVIEW)`.
- `reviewId` becomes **nullable**. Its relation stays `onDelete: Cascade`.
- `chk_media_purpose_owner CHECK ((purpose = 'REVIEW' AND reviewId IS NOT NULL) OR (purpose = 'PRODUCT_IMAGE' AND reviewId IS NULL AND kind = 'IMAGE'))`. Product galleries are images only in v3.
- `chk_media_public_bucket` is unchanged and applies to product images too. Moderation uses the existing `ModerationSubjectType.MEDIA`.

**New model** (physical naming per ADR-0010; CHECK constraints in the migration SQL):

```prisma
/// Presentation of one approved image in a product gallery. Bytes, scan and moderation live on MediaAsset (purpose = PRODUCT_IMAGE).
model ProductImage {
  id            String    @id @default(cuid())
  productId     String
  mediaAssetId  String    @unique
  /// Store-neutral public key of the display master WITHOUT extension: publicKey(assetId,"medium") minus ".webp" = "m/<assetId>/medium".
  /// Equals the Cloudinary public_id (splitCloudinaryKey), so the same value works for MinIO/S3 and Cloudinary. NULL until promoted.
  publicId      String?   @db.VarChar(255)
  format        String    @default("webp") @db.VarChar(8)
  width         Int?      // of the medium variant, set at promotion
  height        Int?
  /// Hex "#rrggbb" from the worker (sharp stats) for the no-CLS placeholder background.
  dominantColor String?   @db.Char(7)
  /// Plain text, ≤ 250 chars, no URLs/emails/phones (reply-policy detectors). NULL → rendered as "<product name> – image <n> of <total>".
  alt           String?   @db.VarChar(250)
  position      Int       @default(0) @db.SmallInt
  isPrimary     Boolean   @default(false)
  /// Set by media.promote in the same transaction that sets MediaAsset.promotedAt; cleared by demote. Public reads require it.
  publishedAt   DateTime? @db.DateTime(3)
  createdById   String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  product    Product    @relation(fields: [productId], references: [id], onDelete: Restrict)
  mediaAsset MediaAsset @relation(fields: [mediaAssetId], references: [id], onDelete: Restrict)
  createdBy  User       @relation("ProductImageCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  @@index([productId, publishedAt, position])
  @@map("product_images")
}
```

**Constraints (migration SQL):**

- `chk_product_images_position CHECK (position BETWEEN 0 AND 11)`.
- `chk_product_images_published CHECK (publishedAt IS NULL OR (publicId IS NOT NULL AND width > 0 AND height > 0))`.
- `chk_product_images_color CHECK (dominantColor IS NULL OR dominantColor REGEXP '^#[0-9a-f]{6}$')`.
- **At most one primary image per product.** MySQL has no partial unique index, so this uses a stored generated column `primaryProductId VARCHAR(191) AS (CASE WHEN isPrimary THEN productId END) STORED` with `UNIQUE KEY product_images_primary_key (primaryProductId)`. The column is declared in Prisma as `primaryProductId String? @unique` and is never written by the app.
- `position` has **no** unique constraint. MySQL cannot defer constraints, so a reorder would collide. The catalogue service renumbers 0…n-1 inside one transaction, and reads order by `(position, createdAt)`.

**Rules:**

- **URL is derived, never stored.** `url = storage.publicUrlFor?.(publicId + "." + format) ?? publicBaseUrl + "/" + publicId + "." + format`, using the existing `getStorage()`. Switching `MEDIA_PUBLIC_STORE` or the cloud name needs no data migration.
- **Who can upload:** staff with the new permission `catalog.media.manage` (added to the ADR-0003 matrix for `ADMIN` and `SUPER_ADMIN`; there is no catalogue role today), and `OWNER`/`MANAGER` members of the product's verified owning seller (`Product.sellerId`). `RESPONDER` cannot upload. The server takes the seller from the database, never from client input (P-2).
- **Limits:** at most 12 images per product, counting non-removed images including pending ones. JPEG, PNG, WebP and HEIC, under the existing image size and pixel limits. One upload slot per request, using the existing presign → confirm flow.
- **Moderation:** every upload goes through the same scan, sanitise and AI/human media moderation as review media, whatever the uploader's role. Staff uploads are not auto-cleared, because MED-037 has no bypass.
- **Primary image:** the visible primary is the `isPrimary` image if it is published. Otherwise it is the published image with the lowest `position`. If none is published, the category glyph placeholder stays. A product never shows a broken primary image.
- **Removal:** delete the `ProductImage` row and demote/delete its `MediaAsset` through the existing demote path. On Cloudinary that path calls `destroy` with `invalidate=true`. The ledger entry follows ADR-0033.
- **Erasure:** catalogue images are not the uploader's personal content. On account erasure, `createdById` follows the same tombstone treatment as `Product.createdById`.
- **Product merge:** images stay on the merged-away product and are not moved automatically. Moving them is a staff action (follow-up).

**Read paths:**

- **Listing cards** query `product_images` by `(productId, publishedAt IS NOT NULL)` and take the visible primary (one indexed lookup per card, batched with `IN`).
- **The product page** loads all published images. The gallery follows `02-catalog-product.md`: lightbox Dialog with arrows, Esc and the "3 of 8" counter; native scroll-snap on mobile.

**Implementation note (V3-04, task #103):** shipped as designed with these deviations: `alt` is `NOT NULL` (required, no fallback text); the seller permission is `product.image.manage` (OWNER/MANAGER, verified seller) instead of a new staff permission, and staff access uses the ADMIN/SUPER_ADMIN tier; approval is a human `MEDIA` case (`POST /api/admin/product-images/:id/decide`); `dominantColor` and HEIC are deferred. See `docs/architecture/data-model.md`.

### D12. AI review summary data model

```prisma
enum ReviewSummaryStatus { READY HIDDEN FAILED }

/// AI-generated pros/cons/summary of a product's published reviews. One row per (product, language); regenerated, never versioned.
model ProductReviewSummary {
  id                String              @id @default(cuid())
  productId         String
  language          String              @default("en") @db.VarChar(16)
  status            ReviewSummaryStatus @default(READY)
  /// JSON arrays of 1..5 plain-text strings, each ≤ 120 chars, validated by zod before write.
  pros              Json
  cons              Json
  summary           String              @db.VarChar(600)
  sourceReviewCount Int
  /// IDs of the reviews used as input (≤ 50); lets removal/erasure find affected summaries without re-running the model.
  sourceReviewIds   Json
  /// sha256 of the sorted "reviewId:publishedVersion" input list; same hash → no regeneration.
  inputHash         String              @db.Char(64)
  model             String              @db.VarChar(64)  // exact provider model id used, e.g. the resolved Gemini model
  promptSha256      String              @db.Char(64)     // pinned summary system prompt, as ADR-0028 does for moderation
  generatedAt       DateTime            @db.DateTime(3)
  hiddenAt          DateTime?           @db.DateTime(3)
  hiddenReason      String?             @db.VarChar(32)  // SOURCE_REMOVED | STAFF | INJECTION_CANARY | VALIDATION
  hiddenById        String?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  product  Product @relation(fields: [productId], references: [id], onDelete: Restrict)
  hiddenBy User?   @relation("ReviewSummaryHiddenBy", fields: [hiddenById], references: [id], onDelete: SetNull)

  @@unique([productId, language])
  @@map("product_review_summaries")
}
```

**Constraints (migration SQL):**

- `chk_product_review_summaries_count CHECK (sourceReviewCount >= 5)`.
- `chk_product_review_summaries_hidden CHECK ((status = 'HIDDEN') = (hiddenAt IS NOT NULL))`.

**Input.** The input is only `PUBLISHED`, non-deleted reviews whose `aggregateExcludedAt` is NULL (burst windows excluded, TRS-004), using their published revision. At most 50 reviews are used: the 25 most helpful (`helpfulWeighted`) plus the 25 most recent, de-duplicated. Each review is sent as delimited untrusted data with rating, title, body and a verified flag. Author names, handles and media are never sent. Fewer than 5 eligible reviews means no summary, and the row is set to `HIDDEN`.

**Contract** (ADR-0028 applied to summaries):

- A separate pinned `SUMMARY_SYSTEM_PROMPT` with its own SHA-256.
- JSON response schema; zod validation.
- Every pro, con and summary string is rejected if it contains a URL, email or phone number (reply-policy detectors), or if it is longer than its limit.
- Injection canaries are run, and a canary hit sets `HIDDEN`/`INJECTION_CANARY`.
- Any provider or validation failure keeps the **previous** READY row. If no row exists, it writes `FAILED` and shows nothing.

**Runtime.**

- New job `summary.generate { productId, language }` on its own queue `ai-summary`, with concurrency 1, BullMQ `jobId = summary:<productId>:<language>` (dedupe) and a 15-minute delay.
- It is triggered from the existing outbox events for review publish, unpublish and remove (ADR-0013 routing). There is also a nightly sweep for summaries older than 30 days whose `inputHash` changed.
- It regenerates only when `inputHash` differs **and** either at least 3 source reviews changed or the row is older than 7 days.
- It uses the shared `ProviderCall`, `Breaker` and `DailyCap` code, but with **separate** instances and a separate daily cap (`SUMMARY_DAILY_CAP`). Summaries can never use up moderation capacity, and the moderation breaker state is not shared.
- `SUMMARY_MODEL` defaults to `MODERATION_MODEL`. The resolved id is stored in `model`.

**Removal and erasure (ADR-0033).** When a review in `sourceReviewIds` is removed, deleted or erased, the same transaction that handles the review sets the summary to `HIDDEN`/`SOURCE_REMOVED` and enqueues regeneration. Text derived from removed content is never shown, even for a short time.

**Display.**

- The summary is shown on the product page only when `status = READY` and `hiddenAt IS NULL`. It is labelled "AI-generated summary of N reviews · updated <date>" (all text from `t()`), with an info popover explaining the method and a link to the reviews.
- It has no effect on ratings, trust score or ranking.
- Sellers cannot edit it.
- Staff can hide it through `catalog.summary.manage`, which is audited (`AuditLog`, actor STAFF). Users can report it with the existing report reasons, and the report opens a staff case.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep "no new dependencies" and hand-build overlays | Focus trapping, `aria-*` wiring, portals and typeahead for 15+ primitives is weeks of work and a recurring a11y risk. Radix is audited and tree-shakes |
| Stay on Tailwind v3.4 | v3 is in maintenance. shadcn 4.x recipes, `tw-animate-css` and `tailwind-merge@3` target v4, and v4 builds faster with less config |
| Run `@tailwindcss/upgrade` and accept its class rewrites | Its scale renames (`shadow-sm`→`shadow-xs`, `rounded-sm`→`rounded-xs`) conflict with our token-overridden scales and would shift every elevation. A manual checklist plus the screenshot gate is safer |
| Hand-write `@theme` CSS instead of generating it | Splits the token source of truth and defeats `design:check` drift detection |
| MUI / Chakra / Mantine | They have their own styling runtimes (emotion or CSS-in-JS), conflict with Tailwind tokens and add 80–150 KB first-load JS |
| Headless UI | Fewer primitives (no tooltip, toast, select-with-typeahead parity, command), and shadcn's ecosystem is Radix-based |
| Install shadcn's theme variables (`--background` etc.) next to ours | Two token systems; contrast checks would no longer cover what ships |
| `framer-motion` | Renamed to `motion`. The old package is maintenance only |
| `motion` with the full `motion.*` API | About 34 KB more first-load JS. `LazyMotion` + `m` + async `domAnimation` keeps it off the critical path |
| GSAP / react-spring | Larger, or less React 19/RSC-friendly. Not needed for the motion inventory we have |
| `next-view-transitions` package | Small, but it wraps `Link` globally and duplicates a ~40-line helper. One less dependency |
| Next `experimental.viewTransition` + React `<ViewTransition>` | Experimental in Next 15.5. Revisit in the Next 16 ADR |
| Heroicons / Phosphor / keep inline SVG | Lucide has the largest set in the 24 px / 1.5 px stroke style the hi-fi spec already uses, is tree-shakeable, and is shadcn's default |
| Theme in a cookie or the database | Reading cookies in the root layout makes every route dynamic, and theme is not account data |
| Geist via the `geist` package | No network needed at build time, but it changes the brand and has narrower script coverage than Inter for i18n (ADR-0009) |
| Google Fonts `<link>` | A runtime third-party request (privacy, CSP `font-src` and `style-src` changes) |
| Default `next/image` optimizer with `remotePatterns` for Cloudinary and MinIO | Cloudinary images would be transcoded twice, `sharp` and cache disk would sit on the VPS, the web container would fetch media URLs server-side, and requests would bypass Cloudinary's CDN edge |
| `images.unoptimized: true` | No responsive `srcset` on Cloudinary. Cards would load 1600 px masters |
| Persisting an absolute `url` on `ProductImage` | It would go stale when switching `MEDIA_PUBLIC_STORE` or the cloud name and would need a data migration. The URL is cheap to derive |
| Separate `ProductMedia` upload pipeline or direct Cloudinary upload widget | It would bypass ClamAV, sanitising, moderation and `chk_media_public_bucket` (MED-037), and would put unapproved bytes on a public CDN |
| `Product.images` JSON column | No FK to `MediaAsset`, so demotion and erasure could not find references, and there would be no constraints |
| `Product.primaryImageId` instead of `isPrimary` | Removing that image leaves a dangling FK, and the cycle `products` ↔ `product_images` makes inserts and deletes awkward |
| `UNIQUE (productId, position)` | MySQL cannot defer constraints, so reorders would need two-phase updates. Renumbering in one transaction is enough |
| Versioned summary history table | No product need. The audit log plus `inputHash`, `model` and `promptSha256` explain any current row |
| Generating summaries on page request | Latency, provider cost per view, and no place to validate before showing |
| Reusing the moderation queue, breaker and cap for summaries | A summary backlog or provider issue could delay moderation, which is safety-critical |

## Consequences

**Positive:**

- Accessible primitives, one icon set, motion and theming, all within measured budgets that CI enforces.
- `design/tokens.json` stays the only token source. Dark mode and contrast checks keep working.
- One build artifact serves both public stores.
- Responsive Cloudinary images with no server-side optimizer.
- Product images inherit every media safety property: scan, sanitise, moderation, DB gate, CDN purge and ledger.
- Summaries are explainable (`model`, `promptSha256`, `inputHash`, source IDs) and are never shown after a source review is removed.

**Negative / risks:**

- The browser floor rises to Safari 16.4, Chrome 111 and Firefox 128.
- The v4 swap can cause subtle visual regressions. The screenshot gate mitigates this.
- shadcn code is vendored, so upstream fixes have to be re-pulled by hand.
- Exact pins need deliberate updates. Security advisories are watched through `pnpm audit` in CI.
- The Inter build needs network access to Google Fonts at build time.
- The minio-mode loader depends on the `thumb`/`medium` key convention (`publicKey()`). Renaming a variant must update the loader. A unit test must cover this.
- Each Cloudinary derived width costs transformation credits, so the width set is capped at 8 and strict transformations are an ops follow-up.
- A `MediaAsset.reviewId` that can be NULL touches review-media queries. Every existing `reviewId` query must also filter `purpose = 'REVIEW'` or rely on the non-null `reviewId`.
- AI summaries add provider cost, bounded by `SUMMARY_DAILY_CAP`. Model output can be wrong. Mitigations: clear labelling, links to the source reviews, staff hide and user report.

## Migration plan (for the V3 tasks)

The sequence follows the 8-task shape of plan #16. The PM may rename tasks, but the **order and gates** are binding. Every task must pass `pnpm qa`, the D10 bundle budget once it exists, and the a11y tests.

| # | Task | Scope | Depends on | Exit gate |
|---|---|---|---|---|
| V3-01 | **This ADR** | Decisions only | — | CEO approval |
| V3-02 | Tailwind v4 engine swap (D3 Step A) + bundle budget tooling (D10) | deps per D2 (Tailwind/PostCSS only), `@config` compat, v4 default fixes, `scripts/bundle-budget.mjs`, `docs/qa/bundle-budget.json` baseline, screenshot baseline | V3-01 | Pixel diff ≤ 0.1 % light and dark; budgets recorded |
| V3-03 | Tokens CSS-first (D3 Step B) + primitives foundation (D4, D5, D7, D8) | `gen.cjs` → `tailwind-theme.css`, delete JS preset, `components.json`, `lib/cn.ts`, first primitives (dialog, sheet, popover, dropdown, tooltip, tabs), lucide, `next-themes` with nonce + theme toggle, Inter via `next/font` + token update; port existing `components/ui/*` onto primitives | V3-02 | CSS snapshot test (D3 B.3); CSP has no violations (Playwright console check); contrast checks pass both themes; shared JS ≤ 115 KB |
| V3-04 | Product image data model + pipeline (D11) | Prisma + migration (`MediaPurpose`, nullable `reviewId`, CHECKs, `product_images`, generated primary column), `catalog.media.manage` permission, presign/confirm for `PRODUCT_IMAGE`, `media.promote`/demote updates `publishedAt`, dominant colour in worker, staff + seller upload/reorder/alt/primary UI, `image-loader.ts` + `next.config.mjs` images block (D9) with unit tests for both store modes, demo seed images | V3-03 | `chk_media_public_bucket` and `chk_media_purpose_owner` tests; loader tests (Cloudinary width snap, MinIO thumb/medium, unknown host passthrough); no `/_next/image` requests in e2e |
| V3-05 | Professional UI: shell, landing, catalogue, product page | Redesign per hi-fi + v3 primitives; `ProductCard` with primary image; gallery/lightbox (async chunk, `domMax`); `LazyMotion` provider (D6); View Transitions helper on card → product | V3-04 | Public read routes ≤ 165 KB; LCP image `priority` + dimensions; reduced-motion e2e (D6.7) for these routes |
| V3-06 | Smart feature: AI review summaries (D12) | Prisma + migration, summary prompt + schema + canaries, `ai-summary` queue/job, outbox routing, hide-on-source-removal, staff hide, report, product page panel | V3-05 (UI slot), V3-04 (migration order) | Contract tests (validation failure keeps previous row; canary → HIDDEN; < 5 reviews → none); erasure test hides summary in the same transaction |
| V3-07 | Remaining screens on v3 | Review flow, compare, profile, account, auth, seller, admin on primitives; remove remaining inline SVG icons | V3-05 | Route-group budgets per D10 |
| V3-08 | Quality gate | Lighthouse CI budgets + web vitals (D10), reduced-motion Playwright project (D6.7), raw-palette lint rule (D3), axe on all routes both themes, `pnpm audit`, update `design/hifi` docs to v3 | V3-02…07 | All budgets green; CEO sign-off |

**Schema migration order:** V3-04 (`media_assets` change + `product_images`) comes before V3-06 (`product_review_summaries`). Both are additive, except that `media_assets.reviewId` becomes nullable. That change is backward-compatible for readers and is deployed before any writer creates a `PRODUCT_IMAGE` row.

**Rollback:**

- V3-02/03 roll back by git revert, because they make no data change.
- V3-04: product image rows can stay while the UI is reverted. Columns that can be NULL do not break the old code.
- V3-06: set `SUMMARY_DAILY_CAP=0` and hide the panel behind `FEATURE_AI_SUMMARY=false`. The flag is checked at runtime on the server only.

## Follow-ups

- V3-02…V3-08 as in the table above. Update [`design/hifi/README.md`](../../design/hifi/README.md) and `00-foundations.md` to the v3 component names in V3-08. This ADR adds only a supersession note.
- Ops: Cloudinary strict transformations with the D9 width allow-list. Watch Cloudinary credits after V3-05.
- Permissions: add `catalog.media.manage` and `catalog.summary.manage` to the ADR-0003 role matrix (V3-04 / V3-06).
- Later ADRs: the Next 16 upgrade (with native `<ViewTransition>`); an in-app reduced-motion toggle if user research asks for it; moving images on product merge; per-locale summaries beyond `en`.
