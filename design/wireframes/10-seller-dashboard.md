# 10 · Seller dashboard `/seller/{id}`

Complements 04 (reviews inbox, reply composer) and 08.1 (analytics). This is the landing page for seller members. Roles (ADR-0003): OWNER/MANAGER (2FA required), RESPONDER. Sellers cannot edit, hide or remove reviews; they may [Report].

```
┌ Seller: {Name} ▾  [Verified ✓ until {date}]  Trust {band} (i)              ┐
│ Nav (tabs, wrap/scroll on narrow): Overview · Reviews · Products · Analytics · Team · Verification
├────────────────────────────────────────────────────────────────────────────┤
│ <h2>Needs your attention</h2>  (list; each item = icon + text + action)    │
│  ⚠ {n} reviews need a reply (oldest {age})            [Open inbox]         │
│  ⚠ Verification expires in {n} days                   [Renew]              │
│  ⚠ {n} reports we filed are awaiting a decision       [View]               │
│  ℹ Our reply was not published: {reason}              [Appeal]             │
├────────────────────────────────────────────────────────────────────────────┤
│ KPI tiles (30 days): Avg rating · New reviews · Reply rate · Median reply time
│ [View full analytics ›]  (same tile component as 08)                      │
├──────────────────────────────┬─────────────────────────────────────────────┤
│ <h2>Latest reviews</h2>      │ <h2>Products</h2>  [Add product]            │
│ (3 cards, [Reply] [Report])  │ table: name · rating · reviews · status     │
├──────────────────────────────┴─────────────────────────────────────────────┤
│ <h2>Team</h2> (OWNER/MANAGER only): members, role ▾, 2FA status text, [Invite]
└────────────────────────────────────────────────────────────────────────────┘
```
## Verification tab (claim flow, OWNER/MANAGER)
Stepper as an ordered list with text status per step (not colour only): 1 Choose method (DNS TXT / meta tag / documents) → 2 Instructions with copy button → 3 [Check now] shows automated check log → 4 Submitted / In review (SLA 3 business days) → Verified (valid 12 months) or Rejected with reason + [Appeal]. Evidence upload follows the 03 pattern.

## Behaviour
- Permission-gated tabs/buttons are **hidden** for roles without permission, not disabled-without-explanation; server enforces.
- Mobile: single column; tabs become a horizontally scrollable list with visible overflow cue or a select; tables become cards.
- States: loading skeleton · empty ("No reviews yet" + how to invite buyers, compliant with guidelines) · error [Retry] · small-n suppression for metrics.
- Seller-facing reviewer data: handle only; no PII.
