# Layout rules for i18n text expansion

Supports ADR-0009 (English first, pseudo-locale `en-XA` at about +35 %). Applies to every wireframe.

| Rule | Detail |
|---|---|
| Budget | Plan for +40 % (de/fr/ru) in buttons, labels, tabs; +100 % for strings under ~10 characters |
| No fixed widths | Buttons, tabs, chips, table headers use `min-w` + padding, never `w-[Npx]`; text wraps (`break-words`, `hyphens-auto`) |
| No truncation by default | Truncate only user content with `line-clamp` plus a "Read more"; never truncate UI labels or errors |
| Flexible rows | Toolbars use `flex-wrap` with gap; nav tabs wrap or scroll with a visible cue; stat tiles grow in height |
| Logical properties | Use `ms-/me-/ps-/pe-/start-/end-/text-start` (tokens preset supports them); no `ml/mr/left/right` for layout. Mirror directional icons with `rtl:` |
| RTL ready | `dir` from locale; wireframe layouts mirror; numbers/ratings keep bidi isolation (`<bdi>`) |
| ICU only | No concatenated fragments; plurals and gender via ICU; counts such as "{n} reviews" are one key |
| Formatting | Dates, numbers, lists via `Intl`; no fixed date width; avoid text-in-images |
| Counters | "0/2,000" uses a localised-number element with room for longer digits |
| Icons | Never replace text with icon-only; every icon has a text partner or accessible name |
| Testing | Playwright smoke in `en-XA`; check at 320 px and 200 % zoom; text-spacing override (WCAG 1.4.12) |

## v3 additions
| Rule | Detail |
|---|---|
| Fluid type | `text-display/h1/h2` use `clamp()`; headings may wrap to 4 lines at +40 %; no fixed heights on hero, bento tiles, cards (use `min-h` + `items-stretch`) |
| Tracking/caps | Negative letter-spacing and `uppercase` eyebrows apply to Latin only; reset with `:lang(ar,he,fa,ja,zh,ko,hi)` (letter-spacing 0, no uppercase) |
| Gradient text | The accented hero word is an ICU rich-text tag (`<accent>…</accent>`), never a split sentence; word order may move per locale |
| Directional UI | Gallery arrows, lightbox keys (←/→), carousels, breadcrumbs, command-palette hints, chevrons mirror in RTL (`rtl:-scale-x-100` or swapped key map); photos, logos, ratings numbers and play icons do not mirror |
| Stars/histogram | Star row and bars fill from inline-start; numbers in `<bdi>`; labels ("5 stars") have `min-w` and wrap, never truncate |
| Bento/grids | Grid placement is source-ordered and uses logical properties; no `order-*` that desyncs DOM and visual order |
| Search/command palette | Diacritic-insensitive matching (`Intl.Collator`), items wrap to 2 lines, shortcut labels localised (⌘ vs Ctrl) |
| AI summaries | Rendered with its own `lang` + `dir=auto`; "Summary in {language}" shown when it differs from the UI locale |
| Theme/labels | System/Light/Dark and every `aria-label` are ICU keys; no icon-only labels |

