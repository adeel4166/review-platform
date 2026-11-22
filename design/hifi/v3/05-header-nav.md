# 05 Header / nav, theme toggle, command palette

## Header (`banner`)
| | Spec |
|---|---|
| Container | sticky `top-0`, height `header-height` (4rem), `z-sticky`. At scroll 0: transparent over hero wash (text on `bg`, gated). After 8px scroll: `.glass` + bottom `border` + `elevation-2` (class swap at scroll via IntersectionObserver sentinel, not a scroll listener). Solid `surface` fallback under reduced transparency / forced-colors / no backdrop-filter |
| Content (≥lg) | logo (start) · primary nav links (Categories, Compare, Top reviewers, Guidelines) · search trigger (centre, looks like an input: "Search products… ⌘K", 44px, `radius-xl`, opens palette) · theme toggle · notifications bell (badge with number **and** sr text) · user menu / "Sign in" + "Sign up" (primary) |
| Tablet (md) | logo · search trigger (icon + "Search" text) · theme · bell · user; nav in the menu sheet |
| Base (<md) | logo · search icon button ("Search", 44px) · menu button ("Menu") → full-height Sheet from inline-end (Radix Dialog): nav list, theme segmented control, language, account; sticky bottom bar (glass) only on pages that define it (product page) |
| Nav link | `text-small font-medium`, 44px target, current page `aria-current="page"` + 2px `primary` underline bar (not colour alone), hover `bg-subtle` `radius-md` |
| Logo | wordmark + glyph; glyph uses `gradient-brand` as SVG fill (decorative, `aria-hidden`), wordmark in `text`; link name "Review Platform, home" |
| Skip link | first focusable, visible on focus, `primary` bg `on-primary`, jumps to `main` |
| Scroll-padding | `scroll-padding-top` = `header-height` + `space-4` so focused elements are never hidden (2.4.11) |

## Theme toggle (ADR-0034 D7)
- **Header (≥md):** a single icon button (44px) showing the *resolved* theme icon (Sun/Moon) that opens a Popover/DropdownMenu with a radio group **System / Light / Dark** (text + icon each, `role=menuitemradio` `aria-checked`). Accessible name "Theme: {current}". Never icon-only options.
- **Menu sheet and footer:** 3-state segmented control (`toggle-group`, `role=radiogroup`), same labels.
- Behaviour: choice stored in `localStorage` (`rp-theme`), applied by `data-theme`; no-JS fallback `prefers-color-scheme`. Change announced via `role=status` "Theme set to Dark". Icon swap rotate+fade `base`; none under reduced motion. `disableTransitionOnChange` prevents flash of mixed colours.
- Hydration: render the button after mount (placeholder same size) to avoid mismatch.

## Command palette (Radix Dialog + `command`, ADR-0034 D4)
| | Spec |
|---|---|
| Open | click the search trigger, ⌘K / Ctrl+K, or `/` (only when focus is not in an editable field; shortcut can be disabled in settings, WCAG 2.1.4). Trigger has `aria-keyshortcuts` and visible hint |
| Surface | `.glass-strong`, `radius-2xl`, `elevation-3`/`4` (modal), width `min(40rem, 100vw - 2rem)`, positioned 12vh from top ≥md; full-screen sheet <md; scrim `overlay` |
| Structure | combobox input (44px+, visible label "Search products, categories and actions" as header text; `role=combobox`, `aria-expanded`, `aria-controls`, `aria-activedescendant`) → results `role=listbox` in groups: **Recent**, **Products** (thumb 2.5rem + name + rating), **Categories**, **Actions** (Write a review, Compare, Theme: Light/Dark/System, Sign in/out), **Help**. Group headings `text-eyebrow` (`text-muted`) |
| Item | 44px min, `radius-lg`; active = `primary-subtle` bg + `on-primary-subtle`/`text` + 2px start bar; shows trailing shortcut hint or ArrowRight (`rtl:-scale-x-100`); match highlighting `font-semibold` + underline (not colour only) |
| Keys | ↑/↓ move (wrap), Enter select, Esc close (first clears query if non-empty), Tab moves focus out to Close button (no trap break), Home/End. Typeahead debounce 150ms; request cancelled on close |
| States | empty query: Recent + Suggested; loading: skeleton rows + `role=status` "Searching…"; no results: "No results for "{q}"" + "Search all products" action + typo hint; offline/error: inline `role=alert` with Retry; theme/actions work offline |
| Live region | result count announced politely: "{n} results" (debounced), not per keystroke |
| Motion | open: fade + scale 0.98→1, `base`, `ease-enter`; close: fade `fast`, `ease-exit`; none under reduced motion |
| i18n | strings via ICU keys; items can wrap to 2 lines; query matching diacritic-insensitive (`Intl.Collator` sensitivity base); RTL: highlight bar and hints mirror |
| Privacy | recent searches stored locally only (not sent), cleared via "Clear recent" action |

## User menu / notifications
Avatar button (`placeholder-avatar-sm`, name in accessible label) → DropdownMenu (`surface-raised`, `elevation-3`, `radius-xl`): Profile, My reviews, Notifications, Settings, Theme, Sign out; items 44px. Bell → popover list (v2) with unread count in text.

## Footer
Theme segmented control + language select + consistent Help/Guidelines/Report link position (3.2.6), v2 content.

## A11y / i18n summary
Landmarks `banner`, `nav aria-label="Primary"`, menu sheet `nav aria-label="Mobile"`; one tab order = visual order; focus rings 3px `focus` with offset; nav wraps instead of truncating at +40 %; at 200 % zoom/320px header collapses to the base layout; RTL mirrors the entire bar (logical props), icons that imply direction use `rtl:`; contrast of `text`/`text-muted`/`link`/`focus` on glass and on `bg` gated in both themes.
