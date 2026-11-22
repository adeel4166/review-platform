# Hi-fi UI design v2 (LIVE-02)

Production-grade specs that supersede the low-fi layouts in [`../wireframes/`](../wireframes/00-conventions.md) (those remain the source for data rules and states logic). Everything here uses only existing tokens in [`../tokens.json`](../tokens.json) (v2 additions: `shadow-lg/xl`, `radius-xl/2xl`, `space-20/24`, `elevation-*`, `placeholder-*`) and Tailwind utilities from `tailwind-preset.cjs`. **No new dependencies.** Icons: inline SVG (24px grid, 1.5px stroke = `placeholder-stroke`).

| File | Contents |
|---|---|
| [00-foundations.md](./00-foundations.md) | Brand, type scale, colour roles, elevation, radius, spacing, illustration/placeholder style, shared components, state kit (empty/loading/error/success), toasts, breakpoints, global a11y |
| [01-shell-landing.md](./01-shell-landing.md) | Header (search, category nav, user menu, notifications), footer, landing page |
| [02-catalog-product.md](./02-catalog-product.md) | Listing cards, product page (gallery, histogram, trust band, filters, review cards, seller replies) |
| [03-review-compare-profile.md](./03-review-compare-profile.md) | Write-review flow, compare, public profile |
| [04-account-auth.md](./04-account-auth.md) | Auth pages, account area, appeals/decisions, invitations/claims/transfers |
| [05-seller-admin.md](./05-seller-admin.md) | Seller dashboard, admin console shell, queues, detail panes |
| [06-page-map.md](./06-page-map.md) | **Every** `apps/web/src/app` route: old → new layout, a11y notes, spec link |

Tooling: `pnpm design:check` (regenerates `tokens.css`/`tailwind-preset.cjs`, fails on drift, runs `check-contrast.cjs`). Token additions must go through `design/gen.cjs` (`elevation` and `placeholder` groups are emitted by it).

Implementation guidance: dev work should land screen by screen using the component names below (`Card`, `Badge`, `Toast`…), mapping to Tailwind classes via the preset (`bg-surface`, `text-text-muted`, `rounded-lg`, `shadow-md`). Where a spec says `elevation-2`, use `shadow-md`; `elevation-3` = `shadow-lg`; `elevation-4` = `shadow-xl` (via `style={{boxShadow:'var(--elevation-N)'}}` or the shadow util).
