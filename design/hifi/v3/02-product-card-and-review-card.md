# 02 Product card (with image) and review card

## Product card (`ProductCard`, ADR-0034 D11 image model)
| | Spec |
|---|---|
| Container | `surface`, 1px `border`, `radius-xl`, `elevation-1`, overflow hidden, `group`. One link: stretched link on the product name. Hover/`focus-within`: `elevation-2`, border `border-strong`, image `scale-hover` inside its frame (200ms `base`, `ease-standard`); none under reduced motion |
| Image | `next/image`, aspect `placeholder-aspect-product` (1/1) via `aspect-square`, `object-cover`, `sizes="(min-width:1024px) 25vw,(min-width:640px) 50vw,100vw"`, `fill`, `priority` only for the first 4 above the fold. Frame `bg-subtle` + `ring-1 ring-inset ring-border`. `alt` = approved alt text from the data model, else product name; decorative duplicate (list thumb next to a name) uses `alt=""`. Blur placeholder = dominant colour from DB. Missing image: v2 placeholder (category glyph, dashed `border`) |
| Image overlays | top-start: category/"Verified seller" chip (solid `surface` chip, never glass, to guarantee text contrast over photos). Top-end: Compare toggle (44px, `aria-pressed`, label "Add {name} to compare") + Save. Bottom: optional `gradient-scrim-bottom` only if a caption sits over the photo (rare; white text) |
| Body (`p-4`, `md:p-5`) | Brand `text-caption text-text-muted`; name `text-h3` `line-clamp-2` (user/catalog content only; full name in `title`-less, available on the product page); rating row: Stars + `4.6` `tabular-nums` + "({n} reviews)" `text-small text-text-muted` (one ICU key); meta row: verified-share "82% verified buyers" with ShieldCheck icon in `verified` + text; price/range optional `text-body font-semibold` |
| Footer chips | max 2: `accent-subtle` "AI summary available" (Sparkles icon + text) when a published summary exists; `success-bg` "Top rated" never colour-only |
| Variants | `default` (grid), `compact` (trending row, 16rem wide, 2 lines reserved for the name, never truncated), `list` (horizontal: image `placeholder-thumb-card` 7rem start, body end; ≥sm) |
| States | default, hover, focus-visible (3px ring around whole card via `focus-within:` on the container, ring on the link `after` pseudo), pressed (`scale-press`, 80ms), compare-selected (`primary` 2px border + check icon + text "Added to compare"), loading (skeleton with identical box: image square + 4 bars, shimmer `placeholder-skeleton-duration`), image-error (placeholder + no retry), unavailable (`bg-subtle` + "No longer listed" text) |
| Contrast | `text`/`text-muted` on `surface` (gated), `verified` on `surface` (gated), `on-accent-subtle` on `accent-subtle` (gated), `star` on `surface` ≥3:1 with numeric value text beside it |
| RTL / i18n | text-start; image frame mirrored by grid, overlays use `start-/end-`; compare/save order mirrors; rating row wraps (`flex-wrap`) ; "(1,234 reviews)" in `<bdi>`; +40 % names wrap to 2 lines, card height grows (grid `items-stretch`, body `flex-1`) |
| A11y | Card is a single tab stop for navigation (the link); Compare/Save are separate buttons (z above stretched link); accessible name of link = product name; rating `role=img aria-label="4.6 out of 5 from 128 reviews"`; no info on hover only |

## Review card (`ReviewCard`)
Replaces v2 review card visually; data and states logic as in v2 02 (verified, helpful votes, seller reply, moderation notices).
| | Spec |
|---|---|
| Container | `surface`, `border`, `radius-xl`, `elevation-0` in lists (rows separated by spacing) / `elevation-1` when featured; padding `p-4` base `p-6` ≥md. **No glass.** Featured ("Most helpful") has 1px `gradient-brand` edge (wrapper `p-px rounded-xl`, inner `surface`) plus a text label "Most helpful" |
| Header | Avatar `placeholder-avatar-md` (initials on `info-bg`/`info`), display name `text-body font-semibold`, trust badge (Trust score chip w/ text), date `<time>` `text-small text-text-muted`; end side: overflow menu (Report, Share) 44px |
| Rating | Stars + "4 out of 5" text; verified badge: ShieldCheck icon + "Verified buyer" (`verified` on `success-bg`, `radius-full`), tooltip/popover explaining how verification works (button-triggered, Esc dismiss) |
| Title/body | Title `text-h3`; body `text-body leading-relaxed max-w-reading`, plain text, per-review `lang` attr; collapsed with `line-clamp-6` + "Read more" button (`aria-expanded`, text includes review title via `aria-label`); **no** truncation of UI labels |
| Pros / cons | two columns ≥md, stacked base; Plus icon in `success` / Minus icon in `danger` with sr labels "Pros"/"Cons" (not colour alone) |
| Media | thumbs row (`placeholder-thumb-card`-based 5rem squares, `radius-lg`, `next/image`), "+n" tile as a button; opens lightbox (03); processing/failed badges per v2 |
| Footer | Helpful button (toggle, `aria-pressed`, "Helpful ({n})" ICU), Not helpful, Reply (for authorised), Report; ≥44px, `gap-2`, wraps |
| Seller reply | nested panel `bg-subtle`, `radius-lg`, start-border 3px `primary`, label "Reply from {seller}" (Store icon), `text-small` date |
| Moderation states | pending/rejected notices as v2 (`warning-bg`/`danger-bg` panels with text + icon) |
| States | default, hover (none on card; only controls), focus-visible per control, expanded, helpful-voted (`primary-subtle` fill + check + `aria-pressed=true`), loading skeleton (avatar circle + 4 lines), voting-pending (inline spinner, `aria-busy`), error (inline `role=alert`), own-review (adds "Your review" `primary-subtle` badge + Edit) |
| Motion | expand/collapse height `base` `ease-standard` (CSS grid-rows trick, no layout-JS); helpful pop `scale-press`→1 `fast`; none under reduced motion |
| RTL / i18n | start/end throughout; stars rendered `dir=ltr` inside `<bdi>` so 1→5 fill direction is consistent per locale convention (filled from start in RTL: mirror the glyph row, number stays LTR); date/number via `Intl`; mixed-language reviews keep `lang` and `dir=auto` on body; button labels wrap |
| A11y | `<article>` with `aria-labelledby`=title; heading level follows section (h3 in product page); helpful count announced via `role=status` on change; vote buttons have visible text |
