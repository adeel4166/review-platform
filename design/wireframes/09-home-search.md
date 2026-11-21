# 09 · Home and search `/` · `/search?q=`

Source: product catalogue, trust scores (data-model), verified-only filter (02). Messaging is Phase 2: no inbox entry.

## 9.1 Home `/`
```
┌ Global shell (00) ───────────────────────────────────────────────┐
│ <h1>Find products you can trust</h1>                             │
│ [🔍 Search products, brands___________________] [Search]         │  role=search, combobox suggestions
│ Popular: [Phones] [Laptops] [Headphones] [Home] …  (links)       │
├──────────────────────────────────────────────────────────────────┤
│ <h2>Top rated this month</h2>        [See all ›]                 │
│ ┌────────┐┌────────┐┌────────┐┌────────┐  (4 cols ≥1024, 2 tab, │
│ │▓ image ││▓       ││▓       ││▓       │   1 col list on mobile)│
│ │{Name}  ││        ││        ││        │                        │
│ │4.6 out of 5 · 312 reviews · ✓ {n}% verified                    │
│ └────────┘└────────┘└────────┘└────────┘                        │
├──────────────────────────────────────────────────────────────────┤
│ <h2>Latest reviews</h2> (cards: title, excerpt, ✓ Verified buyer)│
├──────────────────────────────────────────────────────────────────┤
│ <h2>How we keep reviews honest</h2> 3 short blocks + [Guidelines]│
└──────────────────────────────────────────────────────────────────┘
```
Signed-in users see **Continue where you left off** (draft reviews, pending/rejected review status with [Appeal]).

## 9.2 Search results `/search?q={q}`
```
┌ <h1>{n} results for “{q}”</h1>   Sort ▾ (Relevance | Rating | Most reviewed | Newest)
├───────────────┬──────────────────────────────────────────────────┤
│ Filters (lg)  │ ┌ ▓ ┐ {Product name — may wrap to 3 lines}        │
│ Category ▾    │ │   │ 4.3 out of 5 · 1,284 reviews · Trust {band}  │
│ Brand [ ]…    │ └───┘ {Brand} · {Category}  [Compare ☐]          │
│ Min rating ( )│ …                                                │
│ [ ] Verified- │ Pagination: [‹ Prev] Page 2 of 14 [Next ›]       │
│   reviews only│  (no infinite scroll; or "Load more" button)     │
│ [Clear all]   │                                                  │
└───────────────┴──────────────────────────────────────────────────┘
```
- Mobile/tablet: `[Filters {n}]` button opens a dialog/bottom sheet; applied filters shown as removable chips (each "Remove filter {name}").
- Autocomplete: ARIA combobox (APG), results via `aria-live=polite` count ("5 suggestions"), Esc closes, never auto-navigates.
- Compare ☐ adds to the comparison tray (05); max 4, announced via `role=status`.

## States
Loading skeleton · empty ("No results for “{q}”. Check spelling, try fewer filters" + suggested categories + [Clear filters]) · error with [Retry] · typo suggestion "Did you mean {x}?" · rate-limited (generic retry text).

## A11y / i18n notes
- Result count in `h1` and live region; focus moves to results heading after filter apply.
- Query is echoed as plain text (escaped). Product names, brands and sort labels use flexible-height cards (see [../i18n-layout.md](../i18n-layout.md)).
- Search is language-agnostic in layout; ranking/locale handling is out of scope (open question G-series).
