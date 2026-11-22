# 04 Auth pages and account area

## Auth layout (login, register, verify-email, 2FA, invitations, claims) — replaces: bare forms
Centered `Card` (`radius-xl`, `elevation-2`, max 28rem, `space-8` padding ≥md) on `bg-subtle`; wordmark above; H1; short helper; footer line with the alternate action. Base: card becomes full-width, no elevation, `bg`, padding `space-4`. No marketing side panel on mobile; ≥lg optional left panel with 3 trust bullets (decorative duplicate of landing text, `aria-hidden` not needed since plain text).
| Page | Content specifics |
|---|---|
| `/login` | Email, Password (show/hide button `aria-pressed`), [Sign in], "Forgot password?" link (if supported), link to Create account. Errors: generic "Email or password is incorrect" banner `role=alert`. Rate-limit 429 = warning banner with retry time. |
| `/login/2fa` | 6 single-field code input (one input `inputmode=numeric autocomplete=one-time-code`, not 6 boxes), "Use a recovery code" disclosure, [Verify]; wrong code error inline; locked = warning. |
| `/register` | Name/handle, Email, Password with strength meter (text label + bar, `aria-describedby`), terms checkbox, [Create account]. Success → /verify-email panel. |
| `/verify-email` | States: pending ("Check your inbox", [Resend] with cooldown text), verifying (spinner `role=status`), success (check + [Continue]), expired/invalid (danger + [Resend link]). |
| `/invitations/accept` | Invite summary card (who invited, role/seller), [Accept] [Decline]; invalid/expired panel. |
| `/claims/email-verify` | Result panel (success/expired) with next step to seller verification. |
- **States (all):** loading submit = button spinner; field errors under fields + banner summary; success = redirect + toast "Signed in"; global error panel.
- **A11y:** autofill attributes (`autocomplete=username/current-password/new-password/email`), labels visible, errors linked, focus to first error, password reveal doesn't change focus, 2FA code announced.
- **Mobile:** inputs 16px min font (no iOS zoom), primary button full width.

## Account area — replaces: unstyled stacked pages
Shell: ≥lg left nav 14rem (Profile, Notifications, My submissions, Security) + content; <lg: segmented top nav (scrollable tabs, `nav aria-label="Account"`, `aria-current=page`). Content `Card` sections with H2 and `space-6` gaps.
| Page | New layout |
|---|---|
| `/account/profile` | Avatar upload card (preview, [Change], [Remove], alt guidance, status Badge for processing), form (display name, handle availability check text, bio counter, privacy toggles as switches `role=switch`), sticky save bar on mobile. Success toast "Profile saved". |
| `/account/notifications` | Filter tabs All/Unread; list rows (icon, text, time, unread dot + visually-hidden "Unread"), [Mark all read]; preferences card (email/in-app switches per type). Empty: "You're all caught up". |
| `/account/submissions` | Table ≥md (Product, Status Badge, Rating, Date, Actions) → stacked cards on base. Status chips: Pending (`info`), Published (`success`), Needs changes (`warning`), Rejected (`danger`) + [Appeal] link. Empty: "You haven't reviewed anything" + [Browse products]. |
| `/account/security/2fa/setup` | 3-step: scan QR (existing QrCode, alt text "QR code for authenticator app" + manual key in mono with [Copy] → toast), enter code, save recovery codes (mono list, [Copy] [Download], "I saved them" checkbox gate). Success panel. |
- **A11y:** switches labelled, status never colour-only, tables have captions and headers, QR has text alternative.

## Appeals, decisions, ownership (user-facing flows)
| Page | New layout |
|---|---|
| `/decisions/[id]` | Reading-width card: decision Badge, plain-language reason, policy reference, timeline (Submitted → Reviewed → Decision), [Appeal this decision] primary if eligible, deadline text. |
| `/appeals/new` | Form: context summary card, reason textarea (counter), evidence upload (reuse upload rows), confirm; success panel with reference number and what-happens-next. |
| `/appeals/[id]` | Status header Badge + timeline, messages/outcome card, read-only; empty/404 states. |
| `/ownership-transfers/[id]` | Summary of transfer (from → to, product/seller), [Accept] [Decline] with Dialog confirm; terminal states shown as info/success/danger panels. |
| `/ownership-transfers/cancel` | Confirmation card (destructive Danger button, Dialog), success panel. |
| `/trust/verified-purchases` | Content page: H1, 3-step explainer with illustrations, FAQ as `details/summary`, privacy note about proof redaction; reading width. |
States for all: loading skeleton card, error panel, success panel, mobile = single column with sticky primary action when form long.
