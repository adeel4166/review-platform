# 03 Write review, compare, public profile

## Write-review flow (`/products/[slug]/review`) — replaces: single long form
Stepper layout, reading width 42rem centred; product mini-card (thumb + name) pinned at top (≥lg: sticky right column 18rem with "Writing tips" + guidelines link).
| Step | Content |
|---|---|
| 1 Rating | Large star radiogroup (5 × 44px+, arrow keys, labels "1 – Poor"…"5 – Excellent"), live text of choice |
| 2 Your review | Title (≤120, counter), Body (min length hint, counter, `aria-live` polite at thresholds only), pros/cons optional |
| 3 Photos & video | Dropzone card (dashed `border-strong`, `radius-lg`) + "Choose files" button (keyboard/touch; drag is enhancement), limits text; per-file row: thumb, name, progress bar + text %, status Badge (Uploading / Processing / Ready / Failed→Retry / Remove). Alt-text input per image (optional, encouraged) |
| 4 Verify purchase (optional) | Explains ✓ Verified buyer, upload proof/receipt link, privacy note (proof redacted after review); can skip |
| 5 Review & submit | Read-only summary with Edit links per section, guidelines checkbox, [Submit review] |
Header progress: "Step 2 of 5" text + `<ol>` list with `aria-current=step`; Back/Next at bottom; mobile: sticky bottom bar (Back · Next), steps collapse to "Step n of 5 · title". Draft autosaved (shown as "Saved just now" text, `role=status`); leaving with unsaved changes prompts native confirm.
- **States:** loading = product mini-card + form skeleton; validation error = form `role=alert` banner listing issues (links) + per-field; upload error = row-level danger text + Retry; submit success = full-page success panel (check illustration) "Thanks! Your review is being checked" + moderation timeline (Submitted → AI check → Published) + [View product] [Write another]; toast "Review submitted"; already reviewed = info panel linking to edit; unauthenticated → redirect `/login?next=`; submit error 5xx = inline banner + keeps data; 429 = warning banner with wait time.
- **A11y:** fieldsets/legends, focus moves to step heading on step change, errors summarised and focused on submit, progress bars `role=progressbar` with value text, no timeouts on typing.

## Compare (`/compare`) — replaces: bare table
Header: H1 "Compare products", picker (combobox "Add product", max 4; chips with remove ×). Table `lg+`:
```
              | [thumb] Product A | Product B | Product C |   sticky header row + first column
Overall       | ★ 4.3 (1,204)     | ★ 4.6     | ★ 3.9     |   best value highlighted: Badge "Highest" (icon+text)
Verified share| 86%  ▇▇▇▇▇▇▇▇░░   | 91%       | 70%       |
5★…1★ spread  | mini histogram    |           |           |
Trust score   | 8.4 / 10          |           |           |
Top pros / cons| bullets          |           |           |
Price         | $129              | $149      | —         |
[Write review] [View product]   per column
```
Use real `<table>` with `scope` headers + `<caption>` ("Comparison of 3 products"); differences-only toggle ("Hide identical rows", `aria-pressed`).
- **Mobile (<md):** show 2 columns at a time with horizontal snap and product switcher selects ("Compare A with B"); or stacked per-product cards with row labels; first column sticky within labelled scroll region (`tabindex=0`).
- **States:** 0 products = illustration + "Pick two or more products" + picker; 1 product = hint "Add one more"; loading = table skeleton; error loading one product = column shows inline error + Remove; limit reached = toast info "You can compare up to 4"; success n/a.
- **A11y:** best value not by colour only; bars have numeric text; picker announces additions "Product B added, 2 products selected".

## Public profile (`/u/[handle]`) — replaces: text list
```
HEADER card: Avatar lg · Display name (h1) · @handle · member since · Badges (Top reviewer, Verified buyer ×n)   [Follow] [⋯ Report]
STATS row (4): Reviews · Helpful votes · Followers · Following (tabular, link to lists where available)
TABS: Reviews | Helpful | Followers  (tablist)
LIST: ReviewCards (product thumb + name on top), Pagination
```
Aside ≥lg (16rem): About, joined, favourite categories chips. Follow: toggle button `aria-pressed` with optimistic update; failure → revert + error toast. Own profile: [Edit profile] → `/account/profile`. Messaging/DM buttons **not present** (Phase 2).
- **Mobile:** header stacks, avatar 5rem centred, stats 2×2 grid, tabs scroll horizontally with visible fade; Follow full width.
- **States:** loading = header + 3 review skeletons; no reviews = "{name} hasn't posted reviews yet"; private/suspended = info panel (no data leak); 404 = not-found; follow success toast "You're following {name}".
- **A11y:** one h1; stats are a `dl`; tabs keyboard; follow button label "Follow {name}".
