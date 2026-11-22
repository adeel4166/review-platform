# Hi-fi UI design v3 (V3-02)

Brand identity v3 and hi-fi specs for light **and** dark themes. Follows [ADR-0034](../../../docs/adr/0034-ui-stack-v3-and-product-image-model.md) (Tailwind v4, shadcn/ui on Radix, `lucide-react`, Motion, `next-themes`, `next/font` Inter, `next/image` with a Cloudinary loader). Where a v3 spec differs from [`../`](../README.md) (v2), **v3 wins**; v2 layouts, states and data rules stay valid for anything not listed here.

| File | Contents |
|---|---|
| [00-brand-and-tokens.md](./00-brand-and-tokens.md) | Brand idea, palette, neutral scale, gradients, glass, radius/shadow/elevation, type scale, motion, theme rules, token → Tailwind mapping |
| [01-landing.md](./01-landing.md) | Hero, bento categories, trending products, trust stats |
| [02-product-card-and-review-card.md](./02-product-card-and-review-card.md) | Product card with image, review card |
| [03-product-page.md](./03-product-page.md) | Gallery + lightbox, rating histogram, AI summary card |
| [04-compare.md](./04-compare.md) | Compare page |
| [05-header-nav.md](./05-header-nav.md) | Header/nav, theme toggle, command palette |
| [contrast-report.txt](./contrast-report.txt) | Output of `node design/check-contrast.cjs --verbose` (212 pairs, light + dark, all pass) |

## Source files changed by V3-02
`design/tokens.json` (source) → `design/gen.cjs` → `tokens.css`, `tailwind-preset.cjs` (Tailwind v3, current app), `tailwind-theme.css` (**new**, Tailwind v4 `@theme`, ADR-0034 D3 step B). Existing token names are kept (values changed), so the current app keeps working after `pnpm design:check`; new names are additive.

## Spec conventions
- Class names are semantic Tailwind utilities backed by tokens (`bg-surface`, `text-text-muted`, `rounded-xl`, `shadow-md`, `text-h2`, `bg-gradient-brand`). **No raw hex and no raw Tailwind palette classes** in product code.
- Layout uses logical properties only (`ms-/me-/ps-/pe-/start-/end-/text-start`), directional icons carry `rtl:-scale-x-100`; see [`../../i18n-layout.md`](../../i18n-layout.md). Every spec has an "RTL / i18n" row.
- Each component lists **States** and **A11y**. Contrast: only token pairs gated in `check-contrast.cjs` may be used; each spec names the pair.
- Images come from `next/image` (ADR-0034 D9) with explicit `width/height` or `sizes`, never layout-shifting; missing image uses the v2 placeholder (`bg-subtle`, dashed `border`, category glyph).
