# ADR-0031: In-app notification inbox with per-type preferences; mandatory types are enforced on the server and cannot be disabled

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #77 (M6–M8 spec) |
| **Related** | moderation-pipeline §8, job-catalogue §4.3 · m4-m5-spec D-A5, M45-Q20 (email-only until M7) · wireframe 06 (`/notifications`, settings) · [m6-m8-spec.md §17](../architecture/m6-m8-spec.md#17-notifications-adr-0031) · catalogue `TRS-009` |

## Context

Statements of reasons (DSA, L-2) and security alerts must reach the user. M4–M6 send mandatory notices by email only.
M7 adds the in-app inbox and the preferences screen (wireframe 06 shows mandatory types "disabled with reason").
`TRS-009` requires that a user preference can never suppress a mandatory notification.

## Decision

1. **Tables** as in the draft schema: `Notification` (recipient, type, loose entity ref, `data` with ids and short
   render params only, `groupKey`, `readAt`, `emailedAt`) and `NotificationPreference (userId, type, channel,
   enabled)`. No row = default (enabled).
2. **Mandatory set** is a constant in `packages/core/src/notifications/types.ts`:
   `CONTENT_HELD, CONTENT_REJECTED, CONTENT_REMOVED, CONTENT_RESTORED, MEDIA_REJECTED, APPEAL_RECEIVED,
   APPEAL_DECIDED, ENFORCEMENT_ISSUED, SECURITY_ALERT, PROOF_VERIFIED, PROOF_REJECTED, VERIFIED_LABEL_REVOKED`.
   Mandatory types are delivered on **both** channels.
3. **Enforced twice on the server:** `PUT /api/me/notification-preferences` refuses any row for a mandatory type
   (`422 mandatory_notification`), and `notifications.dispatch` ignores preference rows for mandatory types even if
   one exists in the database (defence against a bypassed API or a bad migration). The UI shows those toggles
   disabled with the reason, but the UI is not the control.
4. **Idempotency:** in-app row unique on `(recipientId, groupKey)` where `groupKey = <type>:<eventId>` for single
   events and `<type>:<entity>:<day>` for aggregated ones (`REVIEW_VOTED_HELPFUL`, `NEW_FOLLOWER`); email uses the job
   id as the provider idempotency key (job-catalogue §4.3).
5. **Fan-out limits:** `FOLLOWED_PRODUCT_REVIEWED` and `SELLER_REPLIED` are in-app only by default, and follower
   fan-out runs in `notifications.fanout` batches of 500 with a cap of 10 000 recipients per event (the rest get the
   item in a daily digest).
6. **Retention:** read notifications 180 days, unread 365 days (`maintenance.notifications-retention`, M8).

## Alternatives considered

| Option | Why not |
|---|---|
| Client-side enforcement only (disabled toggles) | Trivially bypassed by calling the API; `TRS-009` would test the UI, not the guarantee |
| Separate tables per channel | Two sources of truth for one event |
| Store rendered text in `data` | Copies user content and PII into a second table; templates render at read time |

## Consequences

**Positive:** one guarantee enforced at both write and send; the M4–M6 email path is reused.

**Negative / risks:** users cannot mute moderation mail even if they ask; support copy must explain why.

## Follow-ups

- Legal: confirm the mandatory list (L-2) and whether `PROOF_*` must be mandatory.
