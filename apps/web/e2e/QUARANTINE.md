# Quarantine and known gaps

Tests here are either skipped (`test.fixme`, a known gap in the product) or tagged `@quarantine` (run in the
`quarantine` Playwright project, non-blocking in CI). A test leaves quarantine only after it has passed 10 runs in
a row on `main`. Each entry needs an owner and the task that fixes it.

| ID | Status | Why | What unblocks it |
|---|---|---|---|
| E2E-MOD-006 | `@quarantine` (runs, non-blocking) | Needs the media worker to finish processing (ClamAV scan, libvips variants). CI does not run ClamAV, so the photo stays PROCESSING or FAILED. | ClamAV and libvips in the CI worker (M2-3 infra). |
| E2E-AUTH-007 | `fixme` (skipped) | There is no `/login` page. `pages.signIn` in `apps/web/src/server/auth.ts` points at a route that does not exist, so the form journey cannot be tested. Sign-in is covered through the Auth.js endpoint in E2E-AUTH-001/006. | Login and registration pages. |
| E2E-VB-002 | `fixme` (skipped) | The worker uses `StubPurchaseLookup` with no records, so a new review is never marked as a Verified buyer. The seeded review is verified instead (E2E-VB-001). | An order or purchase integration (ADR-0008). |

## Found while writing the suite (product bugs, not test problems)

- **Failed photo uploads are hidden on the success screen.** `ReviewForm.onSubmit` sets `done` after
  `Promise.all(uploads)`, but `upload()` swallows its own errors into a per-photo `failed` state. The author sees
  "Thanks! Your review is pending moderation" even when a photo upload failed. E2E-MOD-005 checks the asset on the
  API, not the screen, so it catches this case without depending on the UI.
- **No login or registration page** (see E2E-AUTH-007).

Neither is fixed here: production source is out of scope for this task.
