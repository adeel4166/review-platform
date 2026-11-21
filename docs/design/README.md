# Design (M1-T4): wireframes, tokens, accessibility

The design sources live in [`/design`](../../design/README.md) so the app scaffold can import the tokens directly. This page is the index.

## Wireframes (low fidelity, mobile first)
| Flow | File |
|---|---|
| Conventions, shell, breakpoints | [00](../../design/wireframes/00-conventions.md) |
| Home and search | [09](../../design/wireframes/09-home-search.md) |
| Product page with reviews | [02](../../design/wireframes/02-product-page.md) |
| Write a review (verified-buyer step, media upload) | [03](../../design/wireframes/03-write-review.md) |
| Seller dashboard | [10](../../design/wireframes/10-seller-dashboard.md), [04](../../design/wireframes/04-seller-reply.md), [08.1](../../design/wireframes/08-analytics.md) |
| Moderation queue (and appeal/seller queues) | [07](../../design/wireframes/07-admin-queues.md) |
| Appeal flow | [11](../../design/wireframes/11-appeal-flow.md) |
| Also: sign-in/2FA, comparison, profile/social, analytics | [01](../../design/wireframes/01-auth.md), [05](../../design/wireframes/05-comparison.md), [06](../../design/wireframes/06-profile-social.md), [08](../../design/wireframes/08-analytics.md) |

## Tokens and accessibility
- Tailwind proposal: [`tailwind-preset.cjs`](../../design/tailwind-preset.cjs), generated from [`tokens.json`](../../design/tokens.json) (colour light/dark, type, spacing, radius, shadow, breakpoints). Regenerate with `node design/gen.cjs`.
- Contrast gate: `node design/check-contrast.cjs` (all pairs, light and dark, must pass WCAG AA).
- [WCAG 2.2 AA checklist](../../design/a11y-checklist.md)
- [i18n text expansion layout rules](../../design/i18n-layout.md)
