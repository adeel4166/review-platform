# 01 Landing

Route `/`. Server component; only interactive leaves are client. Order and landmarks: skip link → header (05) → `main`: hero → bento categories → trending → trust stats → how-it-works (v2 spec, unchanged) → CTA band → footer (v2).

## Hero
| | Spec |
|---|---|
| Background | `bg` + `gradient-hero-mesh` (static, `aria-hidden`), `pb-16 pt-12` base, `pb-24 pt-20` ≥lg |
| Layout | base: stacked, text-start. ≥lg: 12-col, copy `col-span-7`, visual `col-span-5` |
| Eyebrow | `text-eyebrow`, `text-accent`, with Sparkles icon: "AI-checked, human-moderated" |
| h1 | `text-display text-text`, max 3 lines at 1280; one accent word in `gradient-text-brand` (`bg-clip-text text-transparent`, fallback `text-primary`); word is one ICU message part (`<accent>`rich-text tag`</accent>`), never a split sentence |
| Lead | `text-body lg:text-lg text-text-muted max-w-reading` |
| Search | `radius-xl`, `surface`, `border-strong`, `shadow-md`, height 56px; visible label "Search products" above the field (an sr-only label is not enough here); button "Search" `primary`. Opens command palette on `/` or ⌘K (05). Suggestions chips below: 4 category links, `primary-subtle`/`on-primary-subtle` |
| CTAs | Primary "Browse reviews" (`gradient-brand` bg, `on-brand`, `shadow-glow` on hover/focus-visible), secondary "Write a review" (surface + `border-strong`) |
| Visual (≥md) | Stacked glass cards (`.glass`, `radius-2xl`) mocking a review card + rating pill, `aria-hidden`, decorative; hidden <md. Enter: fade+rise `distance-lg`, `slow`, `ease-enter`; none under reduced motion |
| Proof line | avatars (max 4) + "Trusted by {n} verified buyers" `text-small text-text-muted` with `<bdi>` number |

## Bento categories
Section `h2` "Shop by category" + link "All categories". Grid gap `bento-gap` (1rem): base 2 cols (tiles 1 col, "featured" tile spans 2), md 4 cols, lg 6 cols.
| Tile | Size (lg) | Style |
|---|---|---|
| Featured (top category by review volume) | 2 cols × 2 rows | `gradient-brand` bg, `on-brand` text, `shadow-md`, hover `shadow-glow` + `scale-hover`; large category glyph (Lucide, 48px, `aria-hidden`), name `text-h2`, count |
| Standard ×6 | 2×1 (some 1×1) | `surface`, `border`, `radius-2xl`, `elevation-1`; hover `elevation-2`, translate-y `-distance-sm`; icon in `primary-subtle` circle, name `text-h3`, "{n} products" `text-small text-text-muted` |
| "More" | 1×1 | `bg-subtle`, dashed `border`, "All categories" + ArrowRight (`rtl:-scale-x-100`) |
Each tile is one link (stretched, `<a>` around the name; whole tile clickable via `after:absolute after:inset-0`), accessible name "{category}, {n} products". Order = DOM = visual order (no CSS `order`). Tile min height 7rem and grows with text (+40 %).
States: loading = skeleton tiles with same spans; empty (no categories) = EmptyState "Categories are coming soon"; error = inline retry.

## Trending products
`h2` "Trending this week" with `accent-subtle` badge "Trending" (TrendingUp icon + text). Horizontal **scroll-snap** row on base/md (`overflow-x-auto snap-x`, `tabindex=0`, labelled `role=region aria-label="Trending products"`, visible prev/next buttons ≥md, 44px), 4-col grid at ≥lg (no scroll). Card = ProductCard (02) `compact`. Rank number overlay (`#1`…) `tabular-nums` in a `surface` chip with text "Rank 1" sr-only context. Not auto-scrolling, no autoplay.
States: skeleton cards (aspect `1/1` image + 3 lines); empty: hidden section is **not** allowed, show EmptyState "No trending products yet" + "Browse categories".

## Trust stats
Band `bg-subtle` with `radius-2xl` inner panel, `border`. 4 stats (2×2 base, 4×1 ≥lg): verified reviews, products reviewed, % reviews AI-checked and human-moderated, average moderation time. Each: number `text-h1 tabular-nums` (gradient text is hero-only; numbers use `text`), label `text-small text-text-muted`, icon in `accent-subtle` circle. Numbers formatted via `Intl.NumberFormat` (compact), inside `<bdi>`; each is one ICU key. Count-up animation: **none** (static; avoids a11y/reduced-motion issue). Link "How trust works" (`link`, underlined). Data is real aggregates with "as of {date}" `text-caption`; if unavailable, hide the number and show "—" with sr text "Not available", never fabricate.

## Responsive / theme / RTL
- 320px: single column, hero search full-width, tiles 2-col; no horizontal scroll except the labelled trending row.
- Dark: mesh uses the dark `brand-*` stops (lighter, lower perceived intensity); featured tile text `on-brand` is dark ink (gated). Images in trending cards get `ring-1 ring-inset ring-border`.
- RTL: hero visual swaps sides (grid is logical), arrows/chevrons mirrored with `rtl:`, gradients in `gradient-brand` stay 135° (decorative; acceptable to mirror via `rtl:-scale-x-100` on the tile bg pseudo-element only, not on content).
- i18n: h1 can wrap to 4 lines at +40 %; no fixed heights; eyebrow caps/tracking off for non-Latin.

## A11y
One `h1`; `h2` per section; hero decoration `aria-hidden`; gradient text has real text content and ≥4.5:1 at both ends (`primary`/`accent` on `bg`, gated); focus ring on gradient/primary buttons uses the 2px offset so it sits on page bg (gated `focus`/`bg`, 3:1); scroll row keyboard-operable (arrow keys scroll via native focus, Prev/Next buttons); no content only on hover.
