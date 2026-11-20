# 03 · Write a review and upload media `/p/{slug}/review` (also edit `/reviews/{id}/edit`)

Source: media-pipeline (direct-to-bucket upload, scan, EXIF strip, 720p transcode), moderation-pipeline (CLEAN→live, UNSURE→hold, VIOLATION→rejected), data-model (verified proof, incentive disclosure).

Single-page form with section headings (not a long wizard); mobile uses the same order with a sticky `[Submit review]`. Draft autosaves (announced "Draft saved {time}").
```
┌──────────────────────────────────────────────────┐
│ <h1>Review {Product}</h1>  (thumb) {Product}     │
│ 1. Overall rating *                              │
│    ( )1 ( )2 ( )3 ( )4 ( )5   (radiogroup; stars are visual, labels "1 star – Poor"… )
│ 2. Title *            [__________________] 0/100 │
│ 3. Your review *      [                      ]   │
│                       [   textarea, min 50    ]  │
│                       chars 0/5,000 (hint: what you liked, used for how long)
│ 4. Pros / Cons (optional)  [__]  [__]            │
│ 5. Photos & video (optional, up to 5 images + 1 video)
│    ┌───────────────────────────────┐             │
│    │ ▓ Drag files here or [Choose files]        │
│    │ JPG/PNG/WebP ≤10 MB · MP4/MOV ≤200 MB, 60 s │ (limits from media-pipeline config)
│    └───────────────────────────────┘             │
│    File rows (ul): ▓thumb  name  [alt text____]  status  [Remove]
│      status: Uploading 63% · Scanning… · Ready ✓ · ⚠ Rejected: {reason} [Retry]
│ 6. Did you buy this? (verified buyer)            │
│    ( ) Show me as Verified buyer  → [Upload receipt / order link] (private; deleted after check, §6)
│    ( ) No / skip                                 │
│ 7. Disclosure *  ( ) No incentive ( ) Free product ( ) Discount ( ) Other
│ [ ] I confirm this is my own honest experience (guidelines link)
│ [ Submit review ]   [Save draft]   Cancel        │
└──────────────────────────────────────────────────┘
```
## Post-submit result screens (status page `/reviews/{id}`)
| Outcome | Message | Notes |
|---|---|---|
| CLEAN | "Your review is live." | Then staff post-review within 24 h is invisible to author unless removed |
| UNSURE / AI down / media timeout | "Thanks! Your review is being checked and will appear once approved (usually within {n} days)." | Status `Pending review`; can still edit/withdraw |
| VIOLATION | "We can't publish this review: {public reason}." | Shows reason code, [Edit and resubmit] and [Appeal] until `appealableUntil` |
| Media failed | Review not blocked unless policy says so: "1 photo couldn't be used: {reason}" | Text publishes, media omitted or held (moderation-pipeline §2.4) |

## States and validation
- Inline validation on blur + submit; summary at top listing errors as links to fields (focus moves to summary). Counters via `aria-live=off` text announced at thresholds only.
- Upload: per-file progress `<progress>`/`role=progressbar` with text; cancel supported; large-file warning; network drop → "Paused, will resume" ; fail-closed: a file isn't attachable until `Ready`; Submit disabled while uploads pending **with** visible reason text.
- Alt text field per image (recommended, prompt "Describe the photo for people who can't see it").
- Already reviewed → page becomes edit mode with note "Editing sends changes for re-check" (§3.3). Restricted/suspended user → blocking notice + appeal link. Unauthenticated → sign-in with return-to. Own product (seller member) → blocked (COI) with explanation.
- Leave-page guard only when unsaved changes exist.
