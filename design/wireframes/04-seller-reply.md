# 04 · Seller reply and seller dashboard `/seller/{id}/reviews`

Roles (ADR-0003): `RESPONDER` can reply; `OWNER`/`MANAGER` also manage members/claims (2FA required for OWNER/MANAGER). Sellers **cannot** edit, hide or remove reviews; they may [Report].

## 4.1 Reviews inbox
```
┌ Seller: {Name} ▾ (switch seller)  ───────────── Trust {band} (i)  ┐
│ Tabs: Needs reply {n} · Replied · All · Reported by us            │
│ Filters: Product ▾  Stars ▾  Verified ▾  Date ▾      [Search___]  │
├───────────────────────────────────────────────────────────────────┤
│ ★★☆☆☆ "{Title}"  {Product} · ✓ Verified buyer · {date}            │
│ {Body excerpt}  [View on product page ↗]                          │
│                         [Reply]  [Report review]                  │
└───────────────────────────────────────────────────────────────────┘
```
Table on desktop (sortable headers with `aria-sort`), card list on mobile.

## 4.2 Reply composer (inline expand / dialog on mobile)
```
Replying publicly to {Name}'s review                      (review quoted, read-only)
Your reply *  [ textarea  0/1,500 ]
Guidance: Be factual and polite. Don't ask the reviewer to change or remove their review, offer compensation in public, or share personal data.
Replying as: {Seller name} · {Your name} (RESPONDER)  (visible publicly as seller name only)
[ Post reply ]  [Cancel]
```
- Reply passes the same moderation pipeline as reviews → result banners identical to 03 (live / pending / not published + [Appeal]).
- One live reply per review; [Edit reply] re-checks; [Delete reply] confirm dialog.
- **States:** posted · pending · rejected · rate-limited · review removed meanwhile ("This review is no longer available") · restricted seller (read-only banner).
- Reviewer gets a notification on reply (preference-controlled).

## 4.3 Seller verification claim `/seller/{id}/verify`
Method picker (radio): DNS TXT · Website meta tag · Business email domain · Document upload · Marketplace store link → instructions panel with copyable value, [Check now] with last-check log, status chip (`Pending` / `Verified until {date}` / `Rejected: {reason}` + [Appeal] / `More info requested`). Evidence upload reuses the 03 file-row pattern (private bucket note).
