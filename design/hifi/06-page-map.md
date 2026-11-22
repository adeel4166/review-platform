# 06 Page map: old → new (every `apps/web/src/app` route)

Legend: **Old** = current low-fi/plain layout (single-column text, unstyled lists/forms, link-list nav). **New** = hi-fi layout in the linked spec. All pages inherit the new header/footer (01), state kit and toasts (00).

| Route | Old | New layout | Spec | A11y notes |
|---|---|---|---|---|
| `/` | heading + search + list | Hero search, trending categories, top-rated, recent verified reviews, how-trust-works, CTA band | 01 | h1 once; sections labelled; carousels as lists, no autoplay |
| `/products` | plain list + pagination | Filter sidebar/sheet + ProductCard grid, chips, sort | 02 | filters in fieldsets; count live region |
| `/products/[slug]` | stacked text | Gallery + sticky summary, trust band, histogram, filters, ReviewCards with seller replies | 02 | histogram buttons w/ text; lightbox trap |
| `/products/[slug]/review` | one long form | 5-step write-review flow, upload rows, success timeline | 03 | focus to step heading; progressbars with text |
| `/compare` | bare table | Picker + sticky-header comparison table / mobile 2-up | 03 | real table, caption, non-colour "Highest" |
| `/sellers/[slug]` | text profile | Seller storefront header + tabs + product grid | 02 | tabs pattern |
| `/u/[handle]` | text list | Profile header, stats, tabs, review list | 03 | stats `dl`; follow toggle `aria-pressed` |
| `/login` | bare form | Auth card | 04 | autocomplete attrs; generic error |
| `/login/2fa` | bare form | Auth card, single OTP field, recovery disclosure | 04 | `one-time-code` |
| `/register` | bare form | Auth card + password strength (text) | 04 | errors linked |
| `/verify-email` | status text | Auth card with 4 status panels | 04 | `role=status` |
| `/invitations/accept` | text + buttons | Auth card invite summary | 04 | clear Accept/Decline |
| `/claims/email-verify` | status text | Auth card result panel | 04 | status announced |
| `/account/profile` | form | Account shell + avatar card + form + switches | 04 | `role=switch`, sticky save mobile |
| `/account/notifications` | list | Account shell, tabs, rows, prefs card | 04 | unread text not dot-only |
| `/account/submissions` | list | Account shell, status table/cards, appeal links | 04 | captioned table |
| `/account/security/2fa/setup` | steps in text | 3-step setup with QR + recovery codes gate | 04 | QR text alternative |
| `/decisions/[id]` | text | Decision card + timeline + appeal CTA | 04 | timeline `ol` |
| `/appeals/new` | form | Appeal form with context + evidence + success panel | 04 | error summary |
| `/appeals/[id]` | text | Status timeline + outcome card | 04 | status Badge text |
| `/ownership-transfers/[id]` | text + buttons | Transfer summary + confirm dialog | 04 | dialog focus trap |
| `/ownership-transfers/cancel` | button | Destructive confirm card | 04 | Danger + confirm |
| `/trust/verified-purchases` | prose | Explainer with steps + FAQ details | 04 | `details/summary` |
| `/seller` | list | Seller picker cards | 05 | list semantics |
| `/seller/[id]` | stacked text | Seller dashboard overview (KPIs, chart + table, needs-reply) | 05 | chart text alternative |
| `/seller/[id]/verification` | form | Verification checklist stepper | 05 | status text |
| `/sellers/new` | form | Stepper application + success panel | 05 | fieldsets |
| `/admin/moderation` | table | Admin shell, queue table + detail pane | 05 | focus after action |
| `/admin/media` | table | Queue + media preview pane | 05 | media alt/status text |
| `/admin/proofs` | table | Queue + redacted proof viewer | 05 | reveal needs reason, audit notice |
| `/admin/approvals` | table | Two-person approval cards/queue | 05 | disabled reason in text |
| `/admin/appeals` | table | Queue + appeal detail pane | 05 | |
| `/admin/seller-claims` | table | Queue + evidence pane | 05 | |
| `/admin/enforcement` | forms/table | Lookup + sanctions table + add/lift dialog | 05 | confirm destructive |

All 34 `page.tsx` routes under `apps/web/src/app` are covered. Not routes but covered globally: `loading.tsx`/`error.tsx`/`not-found.tsx` follow the state kit in 00.

## Implementation order (suggested)
1. Shell + tokens utilities (Header, Footer, Toast region, Skeleton, Badge, Card). 2. Product ProductCard/listing/product page. 3. Review flow, compare, profile. 4. Auth + account. 5. Seller + admin.
