# 06 · Profile and social `/u/{handle}`

Social features in Phase 1: follow users, follow products/sellers, helpful votes, reports, public profile. **No messaging** (Phase 2): no "Message" button.

## Public profile
```
┌──────────────────────────────────────────────────────────┐
│ (Avatar 96px)  <h1>{Display name}</h1> @{handle}         │
│ Trust: {band} (i)  ·  Member since {yyyy}                │
│ {Bio, 300 chars}                                         │
│ {n} reviews · {n} helpful votes · {n} followers · {n} following
│ [Follow] / [Following ✓]  [⋯ Report / Block]             │
├──────────────────────────────────────────────────────────┤
│ Tabs (role=tablist): Reviews · Photos · Following · Badges │
│ Reviews list = 02 review cards (product-first variant: product thumb+name above rating)
│ Sort ▾ · Verified only [switch]                          │
└──────────────────────────────────────────────────────────┘
```
- Trust band popover explains inputs in plain language (from `TrustScoreSnapshot.components`) without exposing exact internals; numeric score is **not** public for users.
- Follow button: `aria-pressed`, name "Follow {name}"; optimistic update with rollback error.
- Blocked/suspended/deleted users: neutral "This profile isn't available". Private fields never rendered.
- Mobile: header stacks; tabs become horizontally scrollable tablist with visible focus and `scroll-padding`; stats wrap in a 2×2 grid.

## Own profile / settings `/account`
Sections as left nav (desktop) / list (mobile): **Profile** (avatar upload via media pipeline, display name, bio, handle) · **Security** (password, 2FA status/manage, recovery codes, active sessions with [Sign out] per session) · **Notifications** (per-type email/in-app toggles; security alerts and moderation notices are mandatory, shown disabled with reason) · **Privacy & data** (download my data, delete account with step-up) · **My reviews** (status chips: Live / Pending review / Not published + [Edit] [Delete] [Appeal]) · **Appeals** (list with status and decision text).

## Notifications `/notifications`
List grouped by day; unread marked with text "Unread" + weight (not colour only); types: review status, appeal decided, seller reply, new follower, security alert. [Mark all read]. Statement-of-reasons notifications link to the case detail with the appeal button.

## Appeal form `/appeals/new?decision={id}`
Shows decision summary (public reason, date, deadline `appealableUntil` countdown as text) → Statement textarea (required, 2,000) → optional evidence upload (03 pattern) → [Submit appeal]. Confirmation page with expected SLA and status tracking; after decision shows outcome + out-of-court dispute info (L-2, content OPEN).
