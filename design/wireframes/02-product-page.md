# 02 · Product page with rating breakdown and verified-only filter `/p/{slug}`

Source: data-model (Review, ReviewVote, verified-buyer proof, trust), moderation-pipeline (only `PUBLISHED` shown).

## Desktop (≥1024)
```
┌──────────────────────────────────────────────────────────────────────┐
│ Breadcrumb: Home › {Category} › {Brand} › {Product}                  │
├───────────────────────┬──────────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓    │ <h1>{Product name}</h1>  {Brand} · {Seller badge ✓ Verified seller}
│ ▓  gallery (main)  ▓  │ 4.3 ★★★★☆  out of 5 · 1,284 reviews          │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓    │ [Write a review]  [♡ Follow]  [⇄ Compare]    │
│ ▓ ▓ ▓ ▓ thumbs        │ Specs summary (key attributes)               │
├───────────────────────┴──────────────────────────────────────────────┤
│ Tabs/anchors: Overview · Reviews · Specs · Q&A(if any) · Seller      │
├──────────────────────────────────────────────────────────────────────┤
│ <h2>Ratings & reviews</h2>                                           │
│ ┌ Rating breakdown ───────────┐  ┌ Trust summary ──────────────────┐ │
│ │ 4.3  ★★★★☆  1,284 reviews   │  │ ✓ 62% from verified buyers      │ │
│ │ 5 ★ ██████████░░  640 (50%) │  │ Seller trust: {band} (i)        │ │
│ │ 4 ★ ████░░░░░░░░  310 (24%) │  │ Reviews are moderated (i)       │ │
│ │ 3 ★ ██░░░░░░░░░░  150       │  └─────────────────────────────────┘ │
│ │ 2 ★ █░░░░░░░░░░░   90       │                                      │
│ │ 1 ★ █░░░░░░░░░░░   94       │  each row is a button: filters list  │
│ └─────────────────────────────┘                                      │
│ Filters: [✓ Verified buyers only (switch)] Stars ▾ · With media ▾    │
│          Language ▾ · Sort ▾ (Most helpful | Newest | Highest | Lowest)│
│ Showing 1–10 of 790 · Active filters: [Verified ✕] [5 ★ ✕] [Clear all]│
├──────────────────────────────────────────────────────────────────────┤
│ Review card (repeat)                                                  │
│ (Avatar) {Name}  ·  trust band chip · ✓ Verified buyer · {date}      │
│ ★★★★★ 5 out of 5   <h3>{Title}</h3>                                   │
│ {Body, clamped to 5 lines} [Read more]                               │
│ [▓][▓][▓] media thumbs (opens lightbox)    {Received free product}   │
│ Helpful? [👍 Yes {n}] [👎 No]   [Report]   ⋯                          │
│ ┗ Seller response ({Seller}, {date}): {text clamped} [Show more]     │
├──────────────────────────────────────────────────────────────────────┤
│ Pagination: ‹ Prev  1 2 3 … 79  Next ›   (page links, not infinite)  │
└──────────────────────────────────────────────────────────────────────┘
```
## Mobile (<640)
Gallery swipe carousel (arrow buttons + dots as buttons, no auto-advance) → title/rating → sticky bottom bar `[Write a review] [⇄]`. Breakdown collapses to a 5-row bar list; filters open in a **bottom sheet** (`dialog`) via `[Filter & sort ({n})]`, with [Show {count} reviews] apply button. Review cards full-width; actions in an overflow `⋯` menu except Helpful.

## Behaviour
- **Verified-only** is a switch (`role=switch`, `aria-checked`), URL-synced (`?verified=1&stars=5&sort=helpful&page=2`) so it is shareable and back-button safe. Toggling updates the list in a `aria-live=polite` region announcing "Showing 790 reviews, verified buyers only"; focus stays on the switch.
- Breakdown rows are `<button aria-pressed>` with accessible name "5 stars, 640 reviews, 50%. Filter to 5-star reviews"; bars have text counts (not colour only).
- Aggregates on the page respect the filter explicitly: header rating is **all** reviews; a line "Verified buyers: 4.4 (780)" appears when the switch is on.
- Only `PUBLISHED` content is listed; edited-under-review shows previous live version (moderation-pipeline §3.3).
- **States:** loading skeleton · no reviews yet (CTA "Be the first") · zero results for filters (suggest [Clear all]) · error · product `ARCHIVED` banner · viewer's own pending review shown at top with `Pending review` chip (only to them).
- **Report dialog:** reason radio group (ReportReason), optional details (500 chars), submit → confirmation; sign-in required (return-to preserved).
- **Lightbox:** focus trap, Esc closes, arrow keys navigate, alt text from author or "Photo {n} by {name}", video has captions control/pause, no autoplay with sound.
