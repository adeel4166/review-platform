# 01 Global shell and landing page

## Global header (`SiteHeader`)  — replaces: plain text nav bar
```
┌───────────────────────────────────────────────────────────────────────────────┐
│ [Skip to main content]                                                        │
│ ◆ Reviewly   Categories▾  Compare   ┌🔍 Search products, brands…──────┐ 🔔3 (AB▾)│ 64px, surface, border-b
│                                    └──────────────────────────────────┘        │
│ Phones · Laptops · Home · Audio · Beauty · Outdoors · All categories →         │ category strip, 44px (≥lg)
└───────────────────────────────────────────────────────────────────────────────┘
```
(Brand name is a placeholder wordmark; text only, no raster logo.)
- Container `layout-content-max`; sticky (`z-sticky`), `surface`, bottom `border`; on scroll gains `elevation-2`.
- **Search:** combobox (`role=combobox`, `aria-expanded`, `aria-controls`, listbox suggestions `elevation-3`, grouped Products / Categories / Sellers, up to 8, `aria-activedescendant`). Enter → `/products?q=`. Width: flex-1 max 36rem ≥lg; icon button ≤md opening a full-width search sheet with autofocus and a Cancel.
- **Category nav:** `nav aria-label="Categories"`; ≥lg inline strip; <lg inside the menu sheet as an accordion. Disclosure pattern (click/Enter, not hover-only); current category `aria-current`.
- **Notifications:** bell button, badge count text (`3` + visually-hidden "3 unread notifications"); popover `elevation-3` listing latest 5 with timestamps, "Mark all read", "See all" → `/account/notifications`. Empty: "You're all caught up". Loading: 3 skeleton rows. Error: inline retry. **No messaging/inbox entry points (Phase 2).**
- **User menu:** avatar button (`aria-haspopup=menu`); items: My profile (`/u/{handle}`), My reviews (`/account/submissions`), Notifications, Profile settings, Security, Seller dashboard (if seller), Staff console (staff; shows `Staff` badge), Sign out. Logged out: [Sign in] ghost + [Create account] primary (`/login`, `/register`).
- **Mobile (<lg):** row = ☰ menu · wordmark · 🔍 · 🔔 · avatar. Menu = full-height left drawer (`elevation-4`, focus trap, Esc closes) containing categories accordion, Compare, account links.
- States: loading user → avatar skeleton circle; signed-out ↔ in without layout shift; error fetching session → treat as signed-out + no toast.
- A11y: `header role=banner`, `nav` labelled, menus keyboard (Arrow/Home/End/Esc), focus returns to trigger, bell badge not colour-only, search label "Search products" (visually hidden label).

## Footer — replaces: single-line links
`bg-subtle`, top `border`. 4 columns ≥lg (Product: Browse, Compare, How trust works · Company: About, Guidelines · Legal: Terms, Privacy, Cookie settings · Help: Report a problem, Appeals), 2 columns at sm/md, accordion-free stacked list on base. Bottom bar: © year, language/theme toggle (`aria-pressed`/select), "Reviews are moderated by AI and humans" link to trust page. `footer role=contentinfo`, link lists in `nav aria-label="Footer"`.

## Landing page (`/`) — replaces: heading + search form + plain list
```
HERO (bg-subtle → bg, radius-2xl panel ≥md, py space-16)
  H1 display: "Reviews you can trust."   sub (lg, text-muted, max reading): "Verified buyers, moderated by AI and people."
  [🔍 What are you looking for?_______________ ][Search]   (xl radius, elevation-2, 56px)
  Popular: [Headphones] [Laptops] [Coffee makers]  (chips)
  Trust strip: ✓ 12,430 verified reviews · ★ 4.6 avg · 98% moderated < 24h
TRENDING CATEGORIES (H2) — 6 tiles: glyph + name + count; grid 2/3/6 cols; tile = interactive Card
TOP-RATED PRODUCTS (H2 + "See all →") — 4 ProductCards (see 02), horizontal scroll-snap on base
RECENT VERIFIED REVIEWS (H2) — 3 ReviewCards compact (stars, 2-line excerpt, product, ✓ Verified buyer, date)
HOW TRUST WORKS (bg-subtle band) — 3 steps with numerals: 1 Verified purchase proof · 2 AI + human moderation · 3 Transparent trust score; [Learn more] → /trust/verified-purchases
CTA band (primary bg, on-primary text): "Bought something recently? Share what you found." [Write a review] (inverted button)
```
- Data: top-rated/trending/recent come from existing list queries; counts must be real (no fabricated stats — hide strip item if value unavailable).
- **Mobile:** hero padding `space-8`, search full width stacked button below, chips scroll horizontally (scroll region, labelled), category tiles 2 cols, carousels use native scroll-snap with visible partial next card; sections `space-12`.
- **States:** Loading = skeleton hero text + 6 tile skeletons + 4 card skeletons + 3 review skeletons. Empty (fresh install) = "No products yet" panel w/ [Add a seller] for staff else hidden sections (each section hides independently when empty). Error per section: inline panel with Retry; the page never fails entirely if the hero renders. Success: n/a (toast after redirect from sign-in "Welcome back").
- **A11y:** h1 once; sections `aria-labelledby`; carousels are lists (no auto-play); tiles' accessible name = "Headphones, 240 products"; CTA band contrast uses `on-primary`/`primary` (gated); search form `role=search`.
