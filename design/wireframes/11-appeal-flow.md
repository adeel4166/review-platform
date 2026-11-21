# 11 · Appeal flow (author/seller/reporter) `/appeals/*`

Source: `docs/architecture/moderation-lifecycle.md` §5 (A1–A7), moderation-pipeline. Appeals are decided by a human only; there is never an automatic outcome. Extends the short form in 06.

## Journey
```
Not published / Removed ──▶ 11.1 Decision notice ──▶ 11.2 Appeal form ──▶ 11.3 Confirmation
        ▲                                                                   │
        └──── 11.5 Outcome ◀── 11.4 Status page (Submitted → In review) ◀───┘
```
Entry points: notification, email link (opens in-app; sign-in required), review list `[Appeal]`, seller dashboard (10).

## 11.1 Decision notice `/decisions/{id}` (statement of reasons)
```
<h1>Your review was not published</h1>
Content: “{title}” on {Product}            Decided: {date} by {AI | Moderator}
Reason: {policy name} — {plain-language explanation}
What this means: not visible to others. {Strike added: yes/no}
[Appeal this decision]  Appeal by {date} (text countdown "12 days left")
[Edit and resubmit]  (disabled with reason if an appeal is open or edit limit reached)
```
If past deadline: no button, text "The appeal period ended on {date}." with [Contact support].

## 11.2 Appeal form `/appeals/new?decision={id}`
```
<h1>Appeal a decision</h1>
Decision summary (read-only, collapsed details)             ← no re-entry (WCAG 3.3.7)
Why should we reconsider? *  [ textarea, 0/2,000 ]  hint: what we got wrong; do not include personal data of others
Evidence (optional, up to 3 files)  [Choose files]  (drag-and-drop is optional)
  each file row: name · scan status text (Scanning / Clean / Rejected: reason) · [Remove]
[ ] I understand a person who did not make the original decision will review this.
[Submit appeal]  [Cancel]
```
Errors: inline text + summary at top (`role=alert`); an upload error names file, reason and remedy. Draft kept on navigation.

## 11.3 Confirmation
Heading "Appeal received", reference `{id}`, expected response ("within 7 days; 72 hours if no human reviewed the original"), [View status]. Email sent.

## 11.4 Status `/appeals/{id}`
Ordered list of steps with text states: **Submitted** → **In review** → **Decided**. Shows submitted date, statement, evidence, due date. `[Withdraw appeal]` (confirm dialog). Overdue shows "Taking longer than expected" (no automatic outcome).

## 11.5 Outcome
| Result | Copy / UI |
|---|---|
| Upheld | Reviewer note + out-of-court dispute information (content OPEN, L-2) + [Contact support] |
| Overturned | "Your review is live again" + link; strike removed |
| Partially overturned | What changed (note), e.g. strike removed but content stays down |
| Withdrawn | Confirmation only |

## 11.6 Staff side
Appeal queue and decision screen: see 07 §7.2. Guard: reviewer who made the original decision cannot claim; lease banner "Held until {time}", auto-renews while open.

## A11y / i18n notes
- Each page: one `h1`, status via `role=status`, countdowns are static text (no per-second announcements).
- Tone: plain language, no blame; all strings ICU keys, dates/countdowns via `Intl`. Long policy names and German-length buttons wrap; buttons never fixed width.
