# 02 Listing and product pages

## ProductCard (shared) — replaces: bare `<li>` text rows
```
┌─────────────────────────┐   Card interactive (elevation-1 → 2 hover), radius-lg
│ ▓▓▓ thumbnail 1:1 ▓▓▓▓▓ │   thumb aspect placeholder-aspect-product, object-cover, radius-md
│ Brand (xs, text-muted)  │
│ Product name (H3, 2-line clamp max — full name in title/aria) │
│ ★★★★☆ 4.3  (1,204)      │   Stars + value + review count in parens
│ ✓ 86% verified          │   Badge verified (share of verified-buyer reviews)
│ Category chip · from $129│  price only if data exists
└─────────────────────────┘
```
Horizontal variant ≤sm in lists: thumb `placeholder-thumb-card` left, text right. Whole card = one link (stretched link on name). No clamp on rating/verified text (i18n). Unrated: "No reviews yet" instead of stars. Missing thumb → placeholder (see foundations). Accessible name: "{name}, rated 4.3 out of 5 from 1,204 reviews, 86% verified".

## Listing page (`/products`) — replaces: unstyled list + pagination
Layout lg: `[filters 18rem sticky][results grid 3 cols]`; md: filters in drawer, 2 cols results; base: filters in bottom sheet (opened by sticky "Filters (n)" button), 1 col horizontal cards.
- Header row: H1 "Products" / "Results for 'q'", result count (`aria-live=polite`), Sort select (Top rated, Most reviewed, Most verified, Newest).
- Filters: Category (radio list), Rating (4★+ …), Verified share (≥50/75/90), Has media, Seller. Applied filters as removable chips above grid (`aria-label="Remove filter X"`); [Clear all].
- Pagination component below.
- **States:** loading = 9 card skeletons + filter skeleton; empty search = illustration + "No products match 'q'" + suggestions + [Clear filters]; error = page error panel w/ retry keeping filters; filter change shows grid `aria-busy`, not full-page skeleton.
- A11y: filters are a labelled `form` with fieldsets/legends; applying updates URL; focus stays on control; bottom sheet is a dialog.

## Product page (`/products/[slug]`) — replaces: stacked text sections
```
Breadcrumb (nav aria-label=Breadcrumb)
┌ GALLERY (lg col 1–7) ───────────┐ ┌ SUMMARY (col 8–12, sticky ≥lg) ───────────┐
│ main image 4:3, radius-xl       │ │ Brand · H1 name                            │
│ thumbs row (5 + "+n")           │ │ ★ 4.3 · 1,204 reviews · ✓ 86% verified     │
│ (images then videos)            │ │ Price/where-to-buy (if data)               │
└─────────────────────────────────┘ │ [Write a review] primary  [Compare] secondary│
                                    └─────────────────────────────────────────────┘
TRUST BAND (full container, bg-subtle, radius-lg)
RATING BREAKDOWN card (lg: 2 cols)
  Left: big 4.3 (display), Stars, "Based on 1,204 reviews"
  Right: histogram 5→1 rows: [5 ★ button][bar 8px radius-full fill star on star-empty track][count %]
  each row is a button filtering the list (aria-pressed); bar has text count so not colour-only
REVIEWS (H2) — toolbar: Sort ▾ · [✓ Verified buyers only] toggle · Rating filter · Has media · search in reviews
  list of ReviewCards (single column, reading width 42rem + sidebar of filters ≥lg: filters sticky left 16rem)
  Pagination / "Load more"
```
- **Gallery:** image buttons open lightbox Dialog (arrows, Esc, counter "3 of 8", alt text from product + index); video thumbs show play glyph + duration text; processing media shows placeholder + "Processing". Mobile: swipe + dot-less "1/6" counter; thumbs hidden.
- **ReviewCard:**
```
(Avatar) Name · ✓ Verified buyer · 3 weeks ago        [⋯ Report]
★★★★☆  "Title"  (H3)
Body (relaxed, max reading width, "Read more" after 6 lines — button aria-expanded)
media thumbs (96px, open lightbox)
Helpful? [👍 Helpful (12)]                (aria-pressed)  · Edited badge when edited
└ Seller reply (indented, bg-subtle, radius-md, left border 3px primary):
    ▣ Seller · Acme Store · 2 days ago   "reply text"
```
  Seller reply labelled by `Badge` "Seller reply" + seller name; replies are a nested `article` with `aria-label`. Own review shows OwnReviewActions (Edit/Delete) in the ⋯ menu; pending/rejected states show status banner (`warning-bg`/`danger-bg`) visible to author only.
- Filters ≥lg sidebar; <lg a "Filter & sort" button → bottom sheet; applied chips shown.
- **Mobile:** gallery full-bleed on top, summary below, sticky bottom CTA bar (`elevation-2`, [Write a review] + [Compare]) after scroll past summary; histogram rows stay full-width; review media wraps.
- **States:** loading = gallery block + summary + histogram + 3 review skeletons; no reviews = illustration + "No reviews yet — be the first" + [Write a review]; filter-empty = "No reviews match" + Clear; error loading reviews = inline retry (product summary stays); 404 → not-found panel with search; helpful vote error → error toast; report success → success toast "Thanks — we'll take a look".
- **A11y:** histogram = list of buttons, summary text before it ("Rating distribution"); stars have text value; review list `ol` with `article` items and a heading level per item; lightbox focus trap; "Verified buyer" tooltip is also reachable via an info link to /trust/verified-purchases; filters announce result count via `aria-live`.

## Seller storefront (`/sellers/[slug]`) — replaces: text profile
Header card (logo placeholder, name, `Badge verified seller` only if verified, rating, response rate), tabs Products | Reviews | About; products reuse ProductCard grid. States/mobile as listing. A11y: tabs pattern, one h1 (seller name).
