# 05 Seller dashboard and admin console

## Seller dashboard (`/seller`, `/seller/[id]`, `/seller/[id]/verification`, `/sellers/new`) — replaces: stacked text
Shell like account area: ≥lg left nav (Overview, Reviews & replies, Products, Analytics, Verification, Team), <lg tabs.
- **Overview (`/seller/[id]`)**: KPI row of 4 `Card`s (Rating, Review count, Reply rate, Verified share; value `3xl` bold tabular, delta text "+0.2 vs last 30 days" with arrow icon + words), trend chart card (inline SVG line/bar, with data table alternative toggle "View as table"), "Needs reply" list (ReviewCard compact + [Reply] opens inline reply composer with counter and guidelines; success toast "Reply posted"), Verification status card (Badge + next step).
- **`/seller` (index)**: seller picker cards (logo placeholder, name, status Badge) + [Add seller] → `/sellers/new`; empty = illustration + [Register your business].
- **`/sellers/new`**: stepper (Business details → Contact → Review) in reading width; success panel "Application received".
- **Verification (`/seller/[id]/verification`)**: checklist stepper of methods (email domain, document), each row status Badge (Not started / In review / Verified / Failed + reason), upload rows, timeline; claim email resend with cooldown text.
- **States:** loading = KPI + list skeletons; empty replies = "Nothing waiting for a reply" (illustration + text); error = per-card retry; reply failure = inline `danger` + keeps text.
- **Mobile:** KPIs 2×2, charts full-width with table fallback, reply composer in bottom sheet.
- **A11y:** charts have text summary + table; deltas not colour-only; replies announce via live region; tab/nav `aria-current`.

## Admin console shell — replaces: link list
Distinct, denser density (`sm` body text, rows 40px but controls remain 44px target via padding) with persistent **Staff** Badge (`primary` outline) in header.
```
┌ header (surface, Staff badge, search by ID, user menu) ───────────────────────┐
├ rail 15rem ┬ content ─────────────────────────────────────────────────────────┤
│ Moderation │ H1  [filters row: status ▾ queue ▾ age ▾ assignee ▾]   [Bulk ▾]   │
│ Media      │ ┌ QUEUE TABLE (flex-1) ────────────────┐┌ DETAIL PANE 28rem ───┐ │
│ Proofs     │ │ ☐ Item  Type  Age  Risk  Assignee  ▸ ││ selected item        │ │
│ Approvals  │ │ …rows (selected = bg-subtle + 3px    ││ content, signals,    │ │
│ Appeals    │ │ primary left border)                  ││ history, actions     │ │
│ Seller     │ └───────────────────────────────────────┘└──────────────────────┘ │
│  claims    │ Pagination                                                         │
│ Enforcement│                                                                    │
└────────────┴─────────────────────────────────────────────────────────────────┘
```
- **Rail:** `nav aria-label="Staff"`, items with count Badges (text), current `aria-current=page`; collapses <lg into top segmented scroller with hamburger for the rest.
- **Queue table:** real `<table>`, sortable headers (`aria-sort`), row select checkbox, row opens detail pane (button on first cell, not whole-row click only), keyboard `j/k` optional enhancement (documented in a help dialog, never required). Risk shown as text chip (Low/Med/High) + icon. Age relative text with title absolute.
- **Detail pane:** ≥xl side-by-side; lg: overlays as drawer (`elevation-4`); <lg: full-screen page route-like dialog with Back. Sections: Content (with redactions flagged), AI signals (score + reasons list), Reporter notes, History timeline, Action bar sticky bottom: [Approve] [Reject…] [Escalate] (Reject/Enforce require reason textarea in Dialog). Destructive actions use Danger button + confirm.
- **Per-page specifics:** `moderation` (review items + AI signals), `media` (thumb/video preview, processing/failed states, [Reprocess]), `proofs` (redacted proof viewer with reveal-requires-reason + audit notice), `approvals` (two-person approval cards: requester, change diff, [Approve] disabled for requester with text explanation), `appeals` (original decision, appellant statement, outcome form), `seller-claims` (evidence, domain match result, decision), `enforcement` (user/seller lookup, sanctions table, add/lift sanction with expiry).
- **States:** loading = table skeleton 8 rows + empty pane; empty queue = "Queue is clear" success-style panel; error = banner above table with Retry (keeps filters); action success = toast + row removed with focus moved to next row (announced "Item approved. 12 remaining"); conflict (already handled) = warning toast + row refresh; forbidden = access panel.
- **Mobile:** table → card list (type, age, risk, status); filters in bottom sheet; actions sticky bottom.
- **A11y:** focus management after action (next row), live region for counts, table captions, no hover-only controls, sufficient density without <44px targets.
