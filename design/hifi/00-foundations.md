# 00 Foundations

## Brand
Trustworthy, calm, evidence-first. Indigo `primary` is the only accent; green is reserved for *verified/success*, amber for stars/warnings. No decorative gradients; depth comes from elevation and whitespace. Tone: plain, specific copy ("Bought at Acme Store, 3 weeks ago"), never hype.

## Type scale (Inter via `font-family-sans`)
| Role | Token size / weight / line-height | Use |
|---|---|---|
| Display | `4xl` / bold / tight (≥lg); `3xl` below | Landing hero h1 only |
| H1 | `3xl` (≥md) `2xl` (base) / bold / tight | One per page |
| H2 | `2xl`→`xl` / semibold / tight | Section titles |
| H3 | `lg` / semibold / tight | Card titles, panel headers |
| Body | `base` / regular / normal; review text `relaxed`, max `layout-reading-max` | |
| Small | `sm` / regular; **Caption** `xs` / medium (never for essential info alone) | Meta, timestamps |
| Numeric | tabular figures (`font-variant-numeric: tabular-nums`) for ratings, counts, tables | |

## Colour roles (all pairs already gated by `check-contrast.cjs`, light + dark)
Page `bg`; sections alternate `bg` / `bg-subtle`; cards `surface` + 1px `border`; control borders `border-strong`; text `text` / `text-muted`; actions `primary` (hover `primary-hover`, label `on-primary`); links `link` underlined; focus ring `focus`; stars `star` filled / `star-empty` outline; verified `verified` always icon+label; status chips `success|warning|danger|info` text on `*-bg`. Dark mode: same roles via `[data-theme=dark]`/`prefers-color-scheme`; no component may hard-code hex.

## Elevation, radius, spacing
| Level | Token | Use |
|---|---|---|
| 0 | `elevation-0` | flat rows, table rows, inline panels |
| 1 | `elevation-1` | resting cards, inputs focus-less |
| 2 | `elevation-2` | hovered/clickable cards, sticky header (on scroll), sticky CTA bar |
| 3 | `elevation-3` | menus, popovers, filter drawer, search suggestions |
| 4 | `elevation-4` | modals, toasts |

Radius: `sm` chips/inputs-inner, `md` buttons/inputs, `lg` cards, `xl` hero search & modals, `2xl` landing panels, `full` avatars/pills. Spacing scale: 4-pt via `space-1…24`; section vertical rhythm `space-12` mobile → `space-16`/`space-20` desktop; card padding `space-4` base / `space-6` ≥md; grid gap `space-4` / `space-6`. Container: `layout-content-max` centred, side padding `space-4` (base) / `space-6` (md) / `space-8` (lg).

## Illustration / placeholder style
- Flat, single-hue line illustrations (stroke `placeholder-stroke`, colour `text-muted`, accent spot colour `primary`), max 160px, `aria-hidden` (decorative) with adjacent heading carrying meaning.
- **Missing product image:** `bg-subtle` block, aspect `placeholder-aspect-product`, centred category glyph in `text-muted`, `border` dashed. Never a stock photo.
- **Avatar fallback:** `full` circle, `info-bg` fill, initials in `info`; sizes `placeholder-avatar-sm|md|lg`.
- **Skeleton:** blocks in `bg-subtle` (radius matching real element), shimmer sweep `placeholder-skeleton-duration` linear; under reduced motion a static fill. Container gets `aria-busy="true"`, plus a visually-hidden "Loading…" in a `role=status`.
- **Media processing:** thumbnail placeholder + `Badge info` "Processing"; failed → `Badge danger` "Couldn't process" + Retry.

## Shared components
| Component | Spec |
|---|---|
| Button | Heights ≥ `size-target-min` (44px). Primary (`primary`/`on-primary`), Secondary (surface + `border-strong`), Ghost (text link-styled), Danger (`danger` text on `danger-bg`, confirm required for destructive). Loading = spinner + label kept, `aria-disabled`, width stable. |
| Input/Select/Textarea | 44px high, `border-strong`, `radius-md`, label above (never placeholder-only), helper `text-muted sm`, error `danger` with icon + `aria-describedby`, `aria-invalid`. |
| Badge | `radius-full`, `xs` medium, icon + text. Variants: verified, success, warning, danger, info, neutral (`bg-subtle`/`text`), staff (`primary` outline). |
| Stars | 5 glyphs `star`/`star-empty` + numeric value text always present; `role=img aria-label="4.5 out of 5"`. |
| Card | `surface`, `border`, `radius-lg`, `elevation-1`; interactive variant hover `elevation-2`, whole card one link target (stretched link on title). |
| Avatar, Chip (filter toggle `aria-pressed`), Tabs (`role=tablist`, arrows), Pagination (existing component, `nav` + `aria-current`), Tooltip (on focus + hover, Esc dismiss, never sole carrier), Dialog (existing; focus trap, Esc, return focus), Drawer/Bottom sheet (Dialog variant). |
| TrustBand | Existing component restyled: `bg-subtle` panel, shield icon, 3 facts (verified share %, reviews analysed, last moderation pass), "How trust works" link. |

## State kit (applies to every screen below)
| State | Pattern |
|---|---|
| **Loading** | Route `loading.tsx` renders skeleton of the final layout (same grid, no layout shift). >10s adds "Still loading… [Retry]". Buttons show inline spinner. |
| **Empty** | Illustration (≤160px) + H3 + one-sentence reason + primary action ("Be the first to review", "Clear filters", "Browse categories"). Filter-empty offers "Clear filters". `role` none; heading is h2/h3 in sequence. |
| **Error (page)** | Full panel: icon, "Something went wrong", plain cause class (network / not found / forbidden / server), request ID in `font-family-mono` + `text-muted`, [Try again] [Go home]. Next `error.tsx`/`not-found.tsx`. `role=alert` for runtime errors, focus moved to heading. |
| **Error (inline / field)** | `danger-bg` banner (form-level, `role=alert`, links to each invalid field) + per-field message; keep user input. |
| **Success** | Inline `success-bg` panel for completed flows (review submitted, appeal sent) with next steps; transient confirmations use Toast. |
| **Offline / rate-limited (429)** | `warning-bg` banner with retry-after countdown text (not only visual). |

## Toasts
Region: fixed, `z-toast`, bottom-centre on base (above sticky CTA with `space-4` gap, safe-area aware), bottom-right ≥md; stack max 3, newest on top; `elevation-4`, `radius-lg`, width `min(24rem, 100vw - 2rem)`.
| Variant | Colours / icon | Live region | Auto-dismiss |
|---|---|---|---|
| success | `success-bg`/`success`, check | `role=status` (polite) | 5s |
| info | `info-bg`/`info`, i | polite | 5s |
| warning | `warning-bg`/`warning`, triangle | polite | 8s |
| error | `danger-bg`/`danger`, x-circle | `role=alert` (assertive) | persistent until closed |
Rules: dismiss button (44px, labelled "Dismiss notification"), optional single action (e.g. "Undo", 8s window), timer pauses on hover/focus and is disabled when `prefers-reduced-motion` has no effect on duration but removes slide animation (fade only, `motion-fast`). Never the only signal for a critical error; never steal focus.

## Breakpoints (preset `screens`)
| Name | Width | Grid | Behaviour |
|---|---|---|---|
| base | <640 | 4 col, gutter `space-4` | single column; header collapses; filters in bottom sheet; sticky bottom CTA where noted; tables become stacked cards |
| sm | ≥640 | 8 col | 2-col card grids; inline search expands |
| md | ≥768 | 8 col, `space-6` | tablet: 2–3 col grids; filters in drawer; side-by-side forms |
| lg | ≥1024 | 12 col | sidebars (filters, admin rail), 3–4 col grids |
| xl | ≥1280 | 12 col, max `layout-content-max` | extra whitespace only; no new layout |
Each screen spec lists only what *differs* from this default. Min supported width 320px; no horizontal scroll at 320 (except data tables inside a labelled scroll region, `tabindex=0`); content reflows at 400% zoom.

## Global a11y baseline (in addition to [`../a11y-checklist.md`](../a11y-checklist.md))
Skip link first; one `h1`; landmarks `banner/nav/main/contentinfo`; focus ring `focus` 3px; touch targets ≥44px; colour never sole signal; motion only `motion-*` and off under reduced motion; `lang` set; text resizable to 200%; forms with visible labels; dialogs trap focus & restore; async regions announce via `aria-live=polite`; i18n +40% text growth ([`../i18n-layout.md`](../i18n-layout.md)).
