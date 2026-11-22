# Design (M1.4)

Wireframes, design tokens and accessibility baseline for the Review Platform (Phase 1, no messaging).

| File | Purpose |
|---|---|
| [`hifi/`](./hifi/README.md) | **Hi-fi UI design v2 (LIVE-02):** foundations, states/toasts, per-screen specs, old→new page map for every route |
| [`wireframes/`](./wireframes/00-conventions.md) | Responsive low-fi wireframes: 00 conventions/shell · 01 sign-in/2FA · 02 product page (rating breakdown, verified-only filter) · 03 write review + media upload · 04 seller reply (+ verification claim) · 05 comparison · 06 profile/social/account/appeals · 07 admin moderation, appeal and seller queues · 08 analytics dashboards · 09 home/search · 10 seller dashboard · 11 appeal flow |
| [`tokens.json`](./tokens.json) | Source of truth for colour (light + dark), type, spacing, radius, shadow, breakpoints, targets, motion |
| `tokens.css`, `tailwind-preset.cjs` | **Generated** by `node design/gen.cjs`; CSS variables (+ focus ring, reduced-motion) and a Tailwind preset using them |
| [`check-contrast.cjs`](./check-contrast.cjs) | WCAG contrast gate for 25 foreground/background pairs × light/dark |
| [`a11y-checklist.md`](./a11y-checklist.md) | WCAG 2.2 AA baseline and PR checklist |
| [`i18n-layout.md`](./i18n-layout.md) | Layout rules for text expansion (+40 %), RTL, no truncation |

Usage in the app scaffold (M1.5): `import '../design/tokens.css'` in the global stylesheet and `presets: [require('./design/tailwind-preset.cjs')]` in `tailwind.config`.

Wireframes are derived from `docs/architecture/moderation-pipeline.md` (queues, states), `docs/adr/0002` (auth/2FA), `docs/adr/0003` (roles) and `docs/architecture/media-pipeline.md` (uploads). Upload size limits and copy shown are placeholders pending product/legal (see `docs/architecture/open-questions.md`).
