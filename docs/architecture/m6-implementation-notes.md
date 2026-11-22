# M6 implementation notes (task #78)

Implements `m6-m8-spec.md` Part A. Where the code deliberately differs from the spec, it is listed here.

## Test map (named tests)
| Cases | File |
|---|---|
| MOD-001…018, 023, 024, 016 (generated per row + negative matrix), 020 (fault injection), 021, 025, TMR-003/004/006/008/010/013, CFG-003 | `packages/core/src/moderation/transitions.test.ts` |
| CLS-001…013 | `packages/core/src/moderation/classify.test.ts` |
| CFG-001/002/005 | `packages/core/src/moderation/config.test.ts` |
| AIF-008 (fast-check property) | `packages/core/src/moderation/assess.property.test.ts` |
| AIF-001…005, 009 | `packages/core/src/ai/provider.test.ts` |
| SEC-008 (30 canary pairs: `test/fixtures/moderation/injection-canaries.json`) | `packages/core/src/ai/prompt.test.ts` |
| STR-001, AZ-017 | `packages/core/src/moderation/strikes.test.ts` |
| four-eyes rules, BGL-001 rules | `packages/core/src/approvals.test.ts` |
| AIF-006/007, TMR-001/002/005/007/011/012, MED-030, MOD-011 | `apps/worker/src/moderation/{sweep,assess}.int.test.ts` |
| CFG-004, SEC-010, AZ-015, AZ-024, PRV-003, BGL-001, APL-001/002/004, TMR-011, MOD-025 | `apps/web/src/server/m6.int.test.ts` |
| OUT-007 | `packages/core/src/queues.m6.test.ts` |
| CLK-001 | ESLint rule in `eslint.config.mjs` |

## Deviations / deferred
- Migration `20270105000000_moderation_m6` is **additive** (step 1 of 2). Legacy `state`, `aiConfidence`, `aiReasons`,
  `decisionReason`, `decidedById`, `decidedAt`, `openReportKey` and `enum ModerationState` stay until the existing M4/M5 call
  sites (`moderation-service.ts`, `server/moderation.ts`, `server/reports.ts`, worker `moderation.ts`) are re-pointed at
  `transition()`. `chk_case_open_key` is added with the drop.
- The transition engine is written against a `Store` port (`packages/core/src/moderation/transition.ts`) and tested with
  `MemoryStore`. A Prisma-backed adapter and the BullMQ registration of the new jobs are the next step; the legacy
  `processModeration` is still the registered moderation processor.
- Not yet built: queue read-model/lease/bulk HTTP routes, enforcement issue/revoke routes, legal holds, appeal evidence
  slots and staff appeal routes (`decide`/`claim`), decision-notice route, `notifications.dispatch` templates.

## M6/M7 UI (task #80)
- Pages: `/admin/{moderation,appeals,approvals,enforcement}` (staff rail in `app/admin/layout.tsx`), `/decisions/[id]`, `/appeals/new`, `/appeals/[id]`,
  `/account/{submissions,profile,notifications}`, `/u/[handle]`, `/compare` (+ "Compare" checkboxes on `/products`).
- Small server additions the UI needed: `server/m6-ui.ts` (decision notice, "my submissions", appeal queue, pending approvals, `restoreContent` for
  an overturned appeal), `GET/DELETE /api/appeals/[id]`, `GET /api/admin/appeals`, `POST /api/admin/appeals/[id]/{claim,decide}`, `GET /api/admin/approvals`.
- `decideCase` now answers `403 CONFLICT_OF_INTEREST` (was `self_moderation_forbidden`) for a moderator's own review (E2E-008). The queue list also returns
  `status`, `lane`, `holdExpiresAt`, `leaseExpiresAt` and `review.authorId`.
- Break-glass: the "open original" prompt (`OriginalAccess.tsx`) posts reason code + 20..500 char reason to `original-access`, handles step-up/cap/COI/202 and
  opens the single-use content URL. The earlier redacted-copy prompt still uses the `X-Access-Reason` header.
- Not built (backend missing): case leases and bulk actions in the queue UI, Escalate, appeal evidence uploads, ban/user-restrict issue and lift routes,
  appeal overdue text ("Taking longer than expected"), staff config editor/diff, seller analytics (08), follow lists and block UI.
