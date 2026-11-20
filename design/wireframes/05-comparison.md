# 05 · Product comparison `/compare?p=a,b,c` (2–4 products)

## Entry points
`[⇄ Compare]` toggle on product page/cards adds to a **compare tray** (sticky bottom bar listing chosen items as removable chips + [Compare ({n})]); max 4 with explanatory message at limit. Tray is a `region` with `aria-label="Compare list"`; adding announces "{Product} added, {n} of 4".

## Desktop table
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ (sticky col) │ {Product A}  │ {Product B}  │ {Product C}  │
│              │ ▓ image      │ ▓            │ ▓            │
│              │ [Remove]     │ [Remove]     │ [Remove]     │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ Rating       │ 4.3 (1,284)  │ 4.1 (902)    │ 4.6 (88)     │
│ Verified avg │ 4.4          │ 4.0          │ 4.7 (n=31)   │
│ Rating dist. │ mini bars+%  │ …            │ …            │
│ % verified   │ 62%          │ 48%          │ 35%          │
│ Price range  │ …            │ …            │ …            │
│ ▸ Specs  (group headings, collapsible)                      │
│  Battery     │ 10 h         │ 12 h  ◆best  │ 8 h          │
│ ▸ Pros/cons themes (from reviews)                           │
│ Seller trust │ band         │ band         │ band         │
│ [View reviews] [Write review] per column                    │
└──────────────┴──────────────┴──────────────┴──────────────┘
Toggle: [ ] Highlight differences only   [Share link] [Print]
```
- Real `<table>` with `<th scope=col/row>`; "best" cell uses `◆ Best` text + weight, not colour alone; low sample sizes flagged `n=31 (few reviews)`.
- **Mobile:** swipe-free pattern — product selector chips at top, show **2 products side by side** with the third via a [Change] select; spec rows stacked as definition lists; sticky header with product names. Horizontal scroll not required.
- **States:** only 1 product (prompt to add another, with search combobox) · different categories (warn: "Specs may not be comparable") · product unavailable/archived (greyed column + text) · loading skeleton · URL invalid.
