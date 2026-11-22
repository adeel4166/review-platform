# 00 Brand identity v3 and tokens

## Brand idea: "Evidence, lit up"
Still calm and evidence-first (v2), but modern: confident indigo→violet energy for action, a teal **accent** that means *insight / AI / trust signals*, soft cool neutrals, and **glass** reserved for floating chrome. Green stays *verified/success only*, amber stars/warnings only. Gradients are a brand moment (hero, primary CTA on landing, AI card edge, stat numbers), never a text-block background. Tone: plain and specific; no hype.

| Role | Light | Dark | Used for |
|---|---|---|---|
| `bg` / `bg-subtle` | `#FBFBFE` / `#F2F4FA` | `#0A0D1A` / `#0F1424` | page, alternating sections |
| `surface` / `surface-raised` | `#FFFFFF` / `#FFFFFF` | `#151A2E` / `#1B2138` | cards / menus, popovers, command palette |
| `text` / `text-muted` | `#151A2E` / `#4B5470` | `#F1F3FA` / `#C3C9DC` | body / meta |
| `primary` · `-hover` · `on-primary` | `#4F46E5` · `#4338CA` · `#FFFFFF` | `#818CF8` · `#A5B4FC` · `#0A0D1A` | CTAs, selected, links accent |
| `primary-subtle` · `on-primary-subtle` | `#E0E7FF` · `#3730A3` | `#1E2250` · `#C7D2FE` | selected chips, tinted callouts |
| `accent` · `-hover` · `on-accent` | `#0F766E` · `#115E59` · `#FFFFFF` | `#2DD4BF` · `#5EEAD4` · `#0A0D1A` | AI summary, "trending", insight badges |
| `accent-subtle` · `on-accent-subtle` | `#CCFBF1` · `#115E59` | `#0B2F2C` · `#99F6E4` | AI/insight chips |
| `link` / `focus` | `#4338CA` / `#1D4ED8` | `#A5B4FC` / `#93C5FD` | links (underlined) / 3px ring |
| `border` / `border-strong` | `#D5DAE8` / `#667089` | `#2A3150` / `#8E96B0` | decorative / control borders (≥3:1) |
| status `success|warning|danger|info` + `-bg`, `verified`, `star`, `star-empty` | unchanged from v2 hues | unchanged from v2 hues | unchanged semantics |
| `brand-from` · `-via` · `-to` · `on-brand` | `#4338CA` · `#6D28D9` · `#0E7490` · `#FFFFFF` | `#818CF8` · `#A78BFA` · `#2DD4BF` · `#0A0D1A` | gradient stops; label colour on them |
| `glass` / `glass-strong` / `glass-border` | white 72% / 88% / ink 12% | surface 72% / 90% / white 14% | floating chrome only |
| `overlay` | ink 55% | black 65% | modal/sheet scrim |

**Neutral scale** (`neutral-50…950`, theme-independent, cool): `#F7F8FC #EEF0F7 #DDE1EE #C3C9DC #8E96B0 #667089 #4B5470 #373F58 #232A40 #151A2E #0A0D1A`. Illustration/charts only.

## Gradients (decorative; reference theme colours so they flip with the theme)
| Token | Recipe | Use | Text rule |
|---|---|---|---|
| `gradient-brand` | 135° `brand-from → brand-via(55%) → brand-to` | landing primary CTA, bento feature tile, AI-card 1px edge, avatar ring for top reviewers | label colour `on-brand` (≥4.5:1 at all 3 stops, gated) |
| `gradient-brand-soft` | 135° 14% `brand-from` → 10% `brand-to` over `bg` | section wash, compare header | `text`, `text-muted`, `link` (gated via mesh tint pairs) |
| `gradient-hero-mesh` | two radial washes (20% `brand-from`, 16% `brand-to`) | hero background only, `aria-hidden`, static | `text`, `text-muted`, `link` |
| `gradient-text-brand` | 90° `primary → accent` with `background-clip:text` | ONE accent word in the hero h1; `color: var(--color-primary)` fallback; disabled in `forced-colors` | both ends ≥4.5:1 on `bg` (gated) |
| `gradient-scrim-bottom` | 0→65% black bottom-up | caption over product photos | white text only |
No animated/looping gradients (ADR-0034 D6.5).

## Glass
Recipe: class `.glass` (in `tokens.css`): `background: var(--color-glass)`, `backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate))`, 1px `glass-border`. `.glass-strong` (28px blur) for the command palette. **Allowed:** header (after scroll), command palette, sticky compare bar, floating filter/CTA bars, toasts' container never. **Forbidden:** review text blocks, forms, tables, anything holding >2 lines of reading text. Fallback: solid `surface` when `backdrop-filter` is unsupported, under `prefers-reduced-transparency` or `forced-colors`. Gated: `text`, `text-muted`, `link`, `focus`, `border-strong` on glass over `bg`, `bg-subtle` and all three gradient stops, both themes.

## Radius, shadow, elevation
| Token | Value | Use |
|---|---|---|
| `radius-sm/md/lg/xl/2xl/3xl/full` | 4 / 8 / 12 / 16 / 24 / 32 px / pill | chips / buttons+inputs / cards / search+dialogs / bento+hero panels / hero media / avatars+pills. Nested radius = outer − padding |
| `shadow-xs…xl` | ink-tinted layered (light); stronger black (dark, via `shadow-dark`) | see elevation |
| `shadow-glow` | 1px primary ring + soft primary halo | primary CTA hover (landing), featured bento tile; never on form controls |
| Elevation 0–4 | none · sm · md · lg · xl | flat rows · resting cards · hover/sticky header · menus, popovers, command palette · modals/toasts |
Dark theme depth: shadows are weak on dark, so cards also get a `border` (always) and raised layers use `surface-raised`; do not rely on shadow alone to separate layers.

## Typography (`next/font/google` Inter, `--font-inter`, `display: swap`, `adjustFontFallback`)
| Role (Tailwind) | Size | Line-height | Tracking | Weight | Use |
|---|---|---|---|---|---|
| `text-display` | clamp 2.25→3.75rem | 1.05 | −0.03em | 700 | landing h1 only |
| `text-h1` | clamp 1.875→2.5rem | 1.15 | −0.025em | 700 | one per page |
| `text-h2` | clamp 1.5→1.875rem | 1.2 | −0.02em | 600 | section titles |
| `text-h3` | 1.125rem | 1.3 | −0.01em | 600 | card titles |
| `text-body` | 1rem | 1.5 (review text `leading-relaxed`, `max-w-reading`) | 0 | 400 | body; never below 1rem |
| `text-small` | 0.875rem | 1.45 | 0 | 400 | meta |
| `text-caption` | 0.75rem | 1.4 | 0.01em | 500 | non-essential only |
| `text-eyebrow` | 0.75rem uppercase | 1.3 | 0.04em | 600 | section overline; **not** applied to non-Latin scripts (no uppercase, no tracking) |
Numerals: `tabular-nums` for ratings, counts, prices, stats. Negative tracking only on display/h1/h2 and is removed for non-Latin locales (`:lang(ar), :lang(he), :lang(fa), :lang(ja), :lang(zh), :lang(ko), :lang(hi) { letter-spacing: 0 }`). Mono: system stack only (request IDs).

## Motion
| Token | Value | Use |
|---|---|---|
| `instant` / `fast` / `base` / `slow` / `page` | 80 / 120 / 200 / 320 / 400 ms (max 400) | press feedback / hover, focus / popovers, tooltips / sheets, dialogs, accordion / View Transition page change |
| `ease-standard` | `cubic-bezier(.2,0,0,1)` | default |
| `ease-enter` / `ease-exit` | `(0,0,0,1)` / `(.3,0,1,1)` | elements entering / leaving |
| `ease-emphasized` | `(.2,0,0,1.15)` | hover lift, sheet entrance only |
| `distance-sm/md/lg` | 4 / 8 / 16 px | translate offsets for enter/exit and hover lift |
| `scale-press` / `scale-hover` | 0.98 / 1.02 | buttons / bento tiles (not on cards with text) |
**Reduced motion** (`motion-reduced` set, applied by `tokens.css` under `prefers-reduced-motion: reduce`): all durations 1 ms, distances 0, scales 1, view-transition animations off, `scroll-behavior:auto`. Allowed to remain: opacity fades ≤120 ms (via Motion `reducedMotion="user"`). Parity rule: motion never carries information alone (ADR-0034 D6.6). Skeleton shimmer becomes a static fill.

## Theme rules (ADR-0034 D7)
`data-theme` set by `next-themes` (`light|dark`, default `system`), no-JS fallback `prefers-color-scheme`. `color-scheme` is set per theme so native controls/scrollbars match. Toggle = 3-state segmented control (System/Light/Dark) with text labels. Every spec below must be checked in both themes; images get no filter in dark mode (no inversion), but image containers use `bg-subtle` + `border` so light-background photos do not glare: add `ring-1 ring-inset ring-border`.

## Tailwind mapping
- **v3 (today):** `presets: [require('./design/tailwind-preset.cjs')]` + import `tokens.css`. Added: `text-display|h1|h2|h3|body|small|caption|eyebrow`, `tracking-*`, `bg-gradient-*`, `duration-instant|fast|base|slow|page`, `ease-standard|enter|exit|emphasized`, `shadow-xs|glow`, `rounded-3xl`, colours `surface-raised, primary-subtle, on-primary-subtle, accent*, on-accent*, brand-*, on-brand, glass*, overlay`.
- **v4 (ADR-0034 D3):** `@import "…/design/tokens.css"; @import "tailwindcss"; @import "…/design/tailwind-theme.css";`. The generated `@theme` holds light values; the unlayered `tokens.css` overrides win at runtime so theme switching works. Shadows are `@utility` rules (a `@theme` shadow would inline and break dark mode). `@custom-variant dark` uses `[data-theme=dark]`.
- Contrast gate: `node design/check-contrast.cjs` (see [report](./contrast-report.txt)).
