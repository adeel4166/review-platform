# Wireframe conventions

Low-fidelity, ASCII, mobile-first. Each screen lists: **Layout** (mobile 360–639 / tablet 768 / desktop ≥1024), **Components**, **States**, **A11y notes**, **Data/rules source**. Tokens come from [`../tokens.json`](../tokens.json).

Legend: `[Button]` `[ ] checkbox` `( ) radio` `[____]` input `▾` select `★` star `✓` verified `⚠` warning `▓` image/media placeholder `{…}` dynamic data.

## Breakpoints and grid
| Name | Width | Columns | Behaviour |
|---|---|---|---|
| base | <640 | 4, 16px gutter | single column, bottom sheet for filters, sticky bottom CTA |
| sm/md | 640–1023 | 8 | two-column where noted, filters in a dialog |
| lg/xl | ≥1024 | 12, max `layout-content-max` | sidebar filters, side panels |

## Global shell
```
┌──────────────────────────────────────────────────────────────┐
│ [Skip to main content]  (first focusable, visible on focus)  │
│ ☰ Logo   [🔍 Search products____________]   🔔 {n}  (Avatar▾)│  <header role=banner>
├──────────────────────────────────────────────────────────────┤
│ <main id=main>  (h1 per page)                                │
├──────────────────────────────────────────────────────────────┤
│ Footer: About · Guidelines · Legal/Terms · Privacy · Report  │  <footer>
└──────────────────────────────────────────────────────────────┘
```
- Mobile: search collapses to an icon button that opens a full-width search; nav is a disclosure menu (not hover).
- Staff area (`/admin/*`) uses a left rail (desktop) / top tab bar (mobile) and a persistent **Staff** badge; see 07.
- Messaging is Phase 2: **no inbox/DM entry points anywhere** (the 🔔 is notifications only).

## Shared patterns
- **Verified buyer label:** `✓ Verified buyer` (icon + text, token `verified`); never colour alone. Tooltip/disclosure explains what it means (proof is redacted after review, data-model §6).
- **Incentive disclosure:** `Received free/discounted product` chip on reviews where `IncentiveDisclosure` ≠ none.
- **Moderation states shown to authors:** `Live`, `Pending review` (hold), `Not published` (with reason + [Appeal]). Status uses icon + text, announced via `role=status`.
- **Rating:** numeric text always accompanies stars (`4.3 out of 5, 1,284 reviews`); stars are decorative (`aria-hidden`) beside the text.
- **Empty / loading / error:** each list has a skeleton (no spinner-only), an empty state with next action, and an inline error with [Retry]. Errors use `role=alert`; loading regions set `aria-busy`.
- **Toasts:** `role=status`, ≥8 s, dismissible, never the only place for an error.
- **Rate-limit / lockout copy** (threat model): generic, tells user when to retry, never reveals whether an account exists.
