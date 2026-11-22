# ADR-0026: Four-eyes approvals as one `StaffApprovalRequest` flow (config activation, privileged role grants, admin 2FA reset, major-enforcement overturn, repeated break-glass)

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #77 (M6–M8 spec) |
| **Related** | ADR-0002 §4 (step-up), ADR-0003 §2 (`config.manage`, `role.grant.*`, `user.manage`) · threat-model P-3, P-7, AP-1, MT-3, R-9 · [m6-m8-spec.md §8](../architecture/m6-m8-spec.md#8-four-eyes-approvals-adr-0026) · catalogue `CFG-004`, `AZ-015`, `AZ-024`, `SEC-010` |

## Context

Five actions need a second privileged person: moderation-config activation (`CFG-004`, P-7), grants of powerful
roles (`SEC-010`, P-3), an ADMIN's 2FA reset (`AZ-024`), overturning a `BAN`/`SELLER_SUSPENSION` on appeal (AP-1),
and repeated break-glass views of one person's proofs (R-9, ADR-0027). Today only SUPER_ADMIN can grant roles, with
step-up, and nothing has a second approver. Five bespoke "pending" columns would each re-implement expiry, self-approval
checks and auditing.

## Decision

1. **One table, `StaffApprovalRequest`** (`kind`, `status`, `requestedById`, `decidedById`, `targetKey`,
   `payload` (ids, enums and numbers only), `payloadHash` (sha256 of canonical JSON), `expiresAt`, `decidedAt`,
   `executedAt`, `note`). `targetKey` + a unique `openKey` (non-null while `PENDING`) allows one pending request per
   target.
2. **Kinds and who may approve:**

   | Kind | Requester | Approver | Executes |
   |---|---|---|---|
   | `CONFIG_ACTIVATION` | ADMIN/SUPER_ADMIN (`config.manage`) | a **different** ADMIN/SUPER_ADMIN | activates the `ModerationConfig` version |
   | `ROLE_GRANT` (SENIOR_MODERATOR, ADMIN) | SUPER_ADMIN (ADMIN may request SENIOR_MODERATOR) | a different SUPER_ADMIN | inserts `UserRole` |
   | `ROLE_GRANT` (SUPER_ADMIN) | SUPER_ADMIN | a different SUPER_ADMIN | inserts `UserRole` |
   | `TWO_FACTOR_RESET` (target holds ADMIN/SUPER_ADMIN) | ADMIN/SUPER_ADMIN | a different ADMIN/SUPER_ADMIN | resets TOTP, revokes sessions |
   | `ENFORCEMENT_OVERTURN_MAJOR` | appeal reviewer (A4/A5 on `BAN`/`SELLER_SUSPENSION`) | a different SENIOR_MODERATOR, not a decider on the case | runs A4/A5 |
   | `BREAK_GLASS_REPEAT` | SENIOR_MODERATOR | a different SENIOR_MODERATOR or ADMIN | allows the original view (ADR-0027) |

   `MODERATOR` grants stay single-actor (SUPER_ADMIN or ADMIN, step-up). Revocations stay single-actor (removing
   privilege is always safe), with the existing "≥ 2 SUPER_ADMIN" floor.
3. **Rules enforced in `packages/core/src/approvals.ts`, inside the approve transaction:** approver ≠ requester,
   approver ≠ target; both requester and approver passed step-up within 10 minutes; the approver holds the permission
   the action needs; `payloadHash` still matches; the request is `PENDING` and not expired (24 h); every precondition
   of the action (target still eligible, config still `DRAFT` and valid, appeal lease still held by the requester) is
   re-checked. The action and `status = EXECUTED` commit in the same transaction. Failure → `409` with the reason; the
   request stays `PENDING`.
4. **Audit and alerts:** `approval.request`, `approval.approve`, `approval.reject`, `approval.expire` rows, plus the
   action's own audit row with `metadata.approvalRequestId`. `CONFIG_ACTIVATION` stores a compact diff (changed
   JSON paths with old → new values, ≤ 4 KB, numbers and booleans only) in the audit metadata (`CFG-004`). Every
   `ROLE_GRANT` request and execution e-mails all SUPER_ADMINs (P-3 "alert on every grant").
5. Expiry is applied by `maintenance.moderation-sweep` (`status → EXPIRED`), using the injected clock (ADR-0024).

## Alternatives considered

| Option | Why not |
|---|---|
| A pending column per feature (`ModerationConfig.pendingApprovalBy`, `UserRole.pendingUntil` …) | Five copies of the same rules; easy to forget one check |
| Second approver via a shared password or out-of-band ticket | Not attributable in `AuditLog`; cannot be tested |
| Two-person rule for every staff action | Halves moderation throughput; the threat model asks for it only on the actions above |

## Consequences

**Positive:** one tested implementation of self-approval, expiry and re-validation; one admin screen "Approvals".

**Negative / risks:** small teams need at least two ADMINs and two SUPER_ADMINs online within 24 h (already required
by the ≥ 2 SUPER_ADMIN invariant). The existing `POST /api/admin/staff/:id/roles` changes from `200` to `202` with a
request id for the four-eyes kinds.

## Follow-ups

- Ops: staffing note (test-strategy §9.8 already flags the small-team risk).
- QA: `CFG-004`, `AZ-024`, `SEC-010` assert self-approval refusal, expiry and re-validation.
