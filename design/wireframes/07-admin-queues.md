# 07 · Admin: moderation, appeal and seller verification queues `/admin/*`

Source: moderation-pipeline §6 (lanes, lease, COI filter, bulk actions, reason codes), ADR-0003 (permissions), threat model (staff 2FA, step-up, audit). Desktop-first (staff tool) but **fully usable at 768 px**, and read/decide works on mobile (single-column, bulk disabled <768).

## Staff shell
Left rail: Moderation · Appeals · Seller claims · Reports · Users · Sellers · Config (ADMIN) · Audit log · Analytics. Items shown by permission only (not merely disabled). Header shows role chips, 2FA ✓, session timer. Items count badges include text ("Hold: 42").

## 7.1 Moderation queue `/admin/moderation`
```
┌ Lane tabs: Hold 42 · Post-review 310 · Reported 17 · Escalated 3 (senior) ┐
│ Filters ▾ type · verdict · category · score range · trust band · language · age     [Reset]
│ Sort ▾ (lane default)         [ ] Select all on page      Bulk: [Approve] [Confirm] [Reject…]
├────────────────────────────────────────────────────────────────────────────────────┤
│ [ ] ▓thumb  Review · "{excerpt…}"          @author (band)  lang  ⏱ hold expires 2d 4h │
│     AI: UNSURE 0.62 · top: harassment · AI_UNAVAILABLE?   reports: 2   [Open]        │
│ …                                                                                   │
└──────────────────────────────────────────────────────────────────────────────────┘
Bulk bar (sticky, appears when ≥1 selected): "{n} selected (max 100)  [Approve] [Reject…] [Clear]"
```
Mobile/tablet: rows become cards, bulk bar hidden under 768.

### Case detail `/admin/moderation/{caseId}` (split view on desktop; stacked on mobile)
```
┌ Left: Content (snapshot as assessed) ──────────┬ Right: Decision panel ───────────────┐
│ Review ★★ "{title}" {body}                      │ Lease: held by you · 12:41 left      │
│ Media (signed URLs, scan status, [Open])        │ AI verdict UNSURE · score · category │
│ Author: @x trust band · prior strikes {n}       │ ▸ All category scores (expand)       │
│ Product / seller · ✓ Verified buyer?            │ ▸ Rule hits · history timeline       │
│ Reports ({n}): reason, reporter band            │ Reason code *  ▾                     │
│ ⚠ Edited since snapshot? (diff link)            │ Public reason *  [prefilled, editable]│
│                                                 │ [Approve] [Reject] [Escalate]        │
│                                                 │ Next item ›  Skip                    │
└─────────────────────────────────────────────────┴──────────────────────────────────────┘
```
- Decision buttons that remove/reject need reason code + public reason (inline validation); issuing BAN/SELLER_SUSPENSION triggers the step-up dialog (01.5).
- **Keyboard shortcuts** (discoverable via `?`, can be turned off – WCAG 2.1.4): `A` approve, `R` reject, `J/K` next/prev, `E` escalate; only active when no input focused.
- **States:** lease lost ("Reassigned to {name}" → return to queue), item already resolved, COI-hidden (never shown), legal hold (decision disabled + banner), media still scanning (decision allowed only per policy; badge), bulk progress: per-item results table `applied / skipped:<reason> / failed` polled with `aria-live=polite` summary.
- **Bulk reject confirm dialog:** shows count, shared reason code + public reason, warning that each author is notified; [Confirm reject {n}].

## 7.2 Appeal queue `/admin/appeals`
List columns: appellant, content type, original decision + decided by (AI/RULE/human), **SLA due** (text + icon; `HOLD_EXPIRED` first, flagged "No human reviewed"), status. Detail: original case snapshot, full decision history timeline, appellant statement, evidence (private signed links, access audited note), **guard banner** if viewer previously decided (cannot assign). Actions: [Uphold] [Overturn] [Partially overturn] (with strike-void checkbox) + reason + message to appellant (template editable).

## 7.3 Seller verification queue `/admin/seller-claims`
Columns: seller, method, scope, age vs 3-business-day SLA, conflict flag ("2 other claims on this domain"), source (Manual / Spot-check 10%). Detail: automated check log (DNS/meta result + timestamp), evidence docs (virus-scan status), existing claims. Actions: [Verify (valid 12 months)] [Reject (reason required)] [Request more info] (message). Re-verification due list as secondary tab.

## 7.4 Other staff screens (low-fi list)
Reports inbox (grouping by content), User detail (strikes, enforcement history, [Restrict]/[Ban] with step-up), Config editor for moderation thresholds (versioned draft → validate → diff → activate; ADMIN + step-up), Audit log (filterable, read-only, export).
