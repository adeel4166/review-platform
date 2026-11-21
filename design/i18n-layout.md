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
