# Accessibility baseline: WCAG 2.2 AA

Applies to every screen in `wireframes/`. Use as a PR checklist for UI work (M2+) and as the acceptance basis for QA. Automated checks catch ~30–40%; the manual items are mandatory.

## Definition of done (per page/component)
- [ ] Passes axe (CI, e.g. `@axe-core/playwright`) with 0 serious/critical on every state in the wireframe's **States** list
- [ ] Keyboard-only walkthrough done; screen reader spot check (NVDA+Firefox or VoiceOver+Safari) on key flows (sign-in/2FA, write review, moderation decide)
- [ ] 200% zoom and 320 px width: no loss of content, no 2-D scrolling (except data tables/maps inside labelled scroll regions)
- [ ] `prefers-reduced-motion`, forced-colors and dark theme checked
- [ ] `node design/check-contrast.cjs` passes after any colour change

## Checklist by WCAG 2.2 criterion
| Area | Requirement | WCAG | Applied in |
|---|---|---|---|
| Structure | One `h1`, logical heading order, landmarks (`header/nav/main/footer`), page `<title>` unique, `lang` set (per-review `lang` attr for mixed-language content) | 1.3.1, 2.4.2, 3.1.1/3.1.2 | all |
| Skip | "Skip to main content" first focusable | 2.4.1 | 00 shell |
| Text alternatives | Meaningful images/media have alt (user-provided alt for review photos, fallback text); decorative `alt=""`/`aria-hidden`; stars always paired with text | 1.1.1 | 02, 03 |
| Video | Captions or transcript for uploaded video where author supplies; player controls keyboard operable; no autoplay with audio; pause for >5 s moving content | 1.2.x, 1.4.2, 2.2.2 | 02, 03 |
| Colour | Text ≥4.5:1 (large ≥3:1); UI components, focus indicators, chart marks ≥3:1; info never by colour alone (verified, status, "best", unread) | 1.4.1, 1.4.3, 1.4.11 | tokens, all |
| Resize/reflow | Responsive to 320 px; text resizes 200%; rem units; text-spacing overrides don't break layout | 1.4.4, 1.4.10, 1.4.12 | all |
| Hover/focus content | Tooltips/popovers (trust band, verified info) dismissible (Esc), hoverable, persistent; also reachable by keyboard/tap via button | 1.4.13 | 02, 06 |
| Orientation / input purpose | No orientation lock; `autocomplete` tokens on identity fields | 1.3.4, 1.3.5 | 01 |
| Keyboard | All functions operable by keyboard; no traps (modals trap and restore focus correctly); logical tab order = visual order | 2.1.1, 2.1.2, 2.4.3 | all |
| Shortcuts | Single-key shortcuts (staff queue) can be turned off/remapped or only active on focus | 2.1.4 | 07 |
| Focus visible | 3 px `focus` ring with offset on every interactive element, never removed; focus not hidden by sticky header/bottom bars (use `scroll-padding`) | 2.4.7, 2.4.11 (2.2), 2.4.12 | tokens.css |
| Focus appearance (AAA reference) | Our ring (3 px, ≥3:1) also meets 2.4.13 | 2.4.13 | tokens |
| Link/button purpose | Link text meaningful out of context ("Read more about {review title}" via `aria-label`/visually hidden text); consistent names | 2.4.4, 3.2.4 | 02 |
| Pointer targets | Min 24×24 CSS px (we use 44 px `target-min` for primary controls); adequate spacing | 2.5.8 (2.2) | tokens |
| Pointer gestures | Carousel/swipe/drag have single-pointer button alternatives; drag-and-drop upload has "Choose files" button; no path-based gestures | 2.5.1, 2.5.7 (2.2) | 02, 03 |
| Pointer cancel / label in name | Actions fire on up-event; visible label text contained in accessible name | 2.5.2, 2.5.3 | all |
| Motion | Respect reduced motion (global CSS); no flashing >3/s | 2.3.1, 2.3.3 | tokens.css |
| Timing | 2FA 10-min and queue lease 15-min timers: warn before expiry and allow extension (lease auto-renews while page open); no timing on review writing (draft autosave) | 2.2.1 | 01, 07 |
| Forms | Visible persistent labels; required marked in text; instructions before field; errors identified in text with `aria-describedby` + summary; suggestions provided; confirm destructive/financial/legal actions (delete, ban, bulk reject) | 3.3.1–3.3.4 | all forms |
| Redundant entry | Don't ask again for info already given in the same flow (draft, appeal reuses decision data) | 3.3.7 (2.2) | 03, 06 |
| Accessible authentication | No cognitive-function test: paste allowed, password managers work, 2FA single field with `one-time-code`, show-password toggle; CAPTCHA only with accessible alternative | 3.3.8 (2.2) | 01 |
| Consistent help | Help/Guidelines/Report link in same footer position on every page | 3.2.6 (2.2) | 00 |
| Consistent nav | Same order of header/footer/nav across pages; components identified consistently | 3.2.3, 3.2.4 | 00 |
| Status messages | Toasts, filter result counts, upload progress, bulk results via `role=status`/`aria-live=polite`; errors `role=alert`; don't announce per-second timers | 4.1.3 | 02, 03, 07 |
| Name/role/value | Native elements first; custom widgets follow WAI-ARIA APG (tabs, switch, dialog, combobox, listbox); state via `aria-expanded/pressed/checked/selected/current/sort` | 4.1.2 | all |
| Data tables | `<th scope>`, `<caption>`, sortable headers with `aria-sort`; charts have table alternative | 1.3.1 | 05, 07, 08 |
| Dialogs | `role=dialog` + `aria-modal`, labelled, initial focus defined, Esc closes (unless destructive in-flight), focus returns to trigger | 2.4.3, 4.1.2 | 01.5, 02, 07 |
| Dragging/uploads | Upload errors state file name + reason + remedy | 3.3.1 | 03 |
| User-generated content | Review text is plain text; no author-controlled markup/colours; alt text prompt; language attribute from detected language | 1.3.1, 3.1.2 | 02 |

## Content & design guidelines
- Plain language, reading level ≈ grade 8 for system messages; error messages say what happened and what to do.
- Don't use placeholder as label. Don't use icon-only buttons without accessible names.
- Minimum body font 16 px (`font-size-base`); line-height ≥1.5 for body copy.
- Moderation notices (statement of reasons) must be readable without logging in via emailed link equivalents only if privacy allows; otherwise in-app plus email summary.

## Test plan hooks (for M1.6 test strategy)
- Component tests with `jest-axe`; Playwright e2e axe scan per route/state; keyboard-path e2e for 01, 03, 07 decide flow.
- Visual regression in light, dark and 320 px.
- Quarterly manual audit with real assistive tech; track issues with label `a11y`.
