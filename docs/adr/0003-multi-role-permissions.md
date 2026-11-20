# ADR-0003: Multi-role permission model

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-20 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #18 (M1.1) |
| **Related** | ADR-0002 (auth/2FA), [data-model.md](../architecture/data-model.md) (`UserRole`, `SellerMember`, `EnforcementAction`) |

## Context

One person can wear several hats at once:

- **Member:** writes reviews, votes, comments, posts, follows, reports and appeals.
- **Seller member:** belongs to one or more seller organisations, with a role per organisation, and replies to reviews of that seller's products.
- **Staff:** moderator, senior moderator, admin or super admin. Staff are usually also ordinary members.

On top of roles, permissions depend on **ownership** (my review), **relationships** (I am a member of the seller that owns this product), **account state** (suspended, restricted, 2FA not enrolled) and **conflict of interest** (moderating my own content or my own seller's reviews).

We need one model that the web app and the worker both enforce, that we can review against the threat model, and that we can test exhaustively.

## Decision

**Role-based access control, with roles stored in the database and permissions defined in code, plus scoped seller roles and a fixed set of policy guards.** It is implemented as a single `authorize()` function in `packages/core/authz`.

### 1. Role layers

| Layer | Roles | Stored in | Scope |
|---|---|---|---|
| Implicit | `ANONYMOUS`, `MEMBER` (any authenticated `ACTIVE` account with a verified email) | not stored | global |
| Platform (staff) | `MODERATOR`, `SENIOR_MODERATOR`, `ADMIN`, `SUPER_ADMIN` | `UserRole` (many per user) | global |
| Seller (scoped) | `OWNER`, `MANAGER`, `RESPONDER` | `SellerMember` (one role per seller per user) | one `Seller` |

- Roles are **additive bundles** with **no implicit inheritance**. For example, ADMIN does not automatically include moderation permissions. Small teams just grant several roles to the same person. This keeps separation of duties explicit.
- **Permissions are not stored in the database.** The role-to-permission map is TypeScript and versioned with the code. Changing it goes through code review, and the matrix below is the specification its tests check.

### 2. Permission catalog (Phase 1)

Naming convention: `resource.action[.qualifier]`. The `message.*` namespace is **reserved for Phase 2** and is not granted to anyone.

Legend: ✔ allowed. ◐ allowed with the condition in the "Guard" column. Blank means this role does not grant it. Columns are **additive**: every seller member and staff member is also a Member and holds the Member column's permissions, subject to the guards (e.g. COI).

| Permission | Anonymous | Member | Seller RESPONDER | Seller MANAGER | Seller OWNER | MODERATOR | SENIOR_MOD | ADMIN | SUPER_ADMIN | Guard / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| `content.read.public` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Published content only |
| `review.create` | | ◐ | | | | | | | | Email verified. Not a member of the product's seller (COI). No `POSTING_RESTRICTION` |
| `review.update.own` / `review.delete.own` | | ◐ | | | | | | | | Author only. Status ≠ `REMOVED` |
| `review.vote` | | ◐ | | | | | | | | Not own review. Not a member of the product's seller. No `VOTING_RESTRICTION` |
| `proof.submit.own` / `proof.delete.own` | | ◐ | | | | | | | | Review author only |
| `comment.create`, `post.create`, `like.create` | | ◐ | | | | | | | | No `POSTING_RESTRICTION`. Target author has not blocked the actor |
| `follow.create`, `wishlist.manage.own`, `comparison.manage.own` | | ✔ | | | | | | | | `follow` is subject to the block rule |
| `report.create` | | ✔ | | | | | | | | Rate-limited |
| `appeal.create.own` | | ◐ | | | | | | | | Subject of the decision, or the reporter (L-3). One per decision |
| `product.create` | | ◐ | | ✔ | ✔ | | | ✔ | | Member-created products start as `PENDING` and are moderated |
| `product.update` | | | | ◐ | ◐ | | | ✔ | | Seller: only products whose `sellerId` is this seller |
| `product.merge`, `catalog.category.manage` | | | | | | | | ✔ | | |
| `seller.create` | | ✔ | | | | | | | | Creator becomes `OWNER` |
| `seller.profile.update` | | | | ✔ | ✔ | | | ✔ | | |
| `seller.reply` | | | ◐ | ◐ | ◐ | | | | | Seller `VERIFIED`. Product owned by the seller. No `SELLER_REPLY_RESTRICTION`. 2FA for MANAGER/OWNER |
| `seller.post` (post as seller) | | | | ◐ | ◐ | | | | | Seller `VERIFIED` |
| `seller.member.invite` | | | | ◐ | ✔ | | | | | MANAGER can invite `RESPONDER` only |
| `seller.member.manage` (role changes, removal, ownership transfer) | | | | | ◐ | | | | | Step-up. At least one OWNER must remain |
| `seller.claim.submit` | | | | ✔ | ✔ | | | | | |
| `seller.claim.review` | | | | | | | | ◐ | | Not a member of the claiming seller |
| `moderation.queue.read` | | | | | | ✔ | ✔ | ✔ | | |
| `moderation.decide` | | | | | | ◐ | ◐ | | | Not own content. Not content about a seller the moderator belongs to |
| `proof.review` (redacted copy) | | | | | | ◐ | ◐ | | | Same COI guard. Viewing is audited |
| `proof.view_original` (break-glass) | | | | | | | ◐ | | | Step-up + typed reason. Always audited |
| `enforcement.issue.minor` (`WARNING`, `CONTENT_REMOVAL`, `POSTING_/VOTING_RESTRICTION` ≤ 7 days) | | | | | | ◐ | ◐ | | | COI guard |
| `enforcement.issue.major` (`SUSPENSION`, `BAN`, `VERIFIED_LABEL_REVOKED`, `SELLER_*`) | | | | | | | ◐ | | | COI guard. Step-up for `BAN` / `SELLER_SUSPENSION` |
| `enforcement.revoke` | | | | | | | ◐ | ✔ | | |
| `appeal.decide` | | | | | | | ◐ | | | **Reviewer ≠ original decider** (no human decider on the case or action) |
| `user.manage` (view account, force logout, reset 2FA request) | | | | | | | | ◐ | ✔ | Step-up. 2FA reset needs a second ADMIN/SUPER_ADMIN (four-eyes) |
| `role.grant.staff` (MODERATOR, SENIOR_MODERATOR) | | | | | | | | ◐ | ✔ | Step-up. Cannot grant to self |
| `role.grant.admin` (ADMIN, SUPER_ADMIN) | | | | | | | | | ◐ | Step-up. Cannot grant to self. At least 2 SUPER_ADMINs at all times (runbook) |
| `legal_hold.manage` | | | | | | | | ◐ | ✔ | Step-up. Audited |
| `audit.read` | | | | | | | ◐ | ◐ | ✔ | SENIOR_MOD: moderation actions only. ADMIN: all except `role.*` and `audit.*` entries |
| `config.manage` (moderation thresholds, feature flags) | | | | | | | | ◐ | ✔ | Step-up. Audited |

Seller columns apply only **within that seller's scope**. A user who is RESPONDER at seller A has no
seller permissions at seller B.

### 3. Policy guards (evaluated in this order; deny wins)

1. **Authentication and session.** Valid session, not `secondFactorPending`, not revoked.
2. **Account state.** `BANNED` or `DELETED`: deny everything except `content.read.public` and `appeal.create.own`. `SUSPENDED`: read-only plus `appeal.create.own`. Active `POSTING_RESTRICTION`, `VOTING_RESTRICTION` and `SELLER_REPLY_RESTRICTION` remove the matching permissions. Active `SELLER_SUSPENSION` removes all seller-scoped permissions for every member of that seller. `EnforcementAction` is the source of truth, not the cached `User.status`.
3. **2FA gate.** Any `PlatformRole` permission, or seller `OWNER`/`MANAGER` permission, requires that the user has 2FA enrolled **and** that the session has `secondFactorVerifiedAt` set. If either is missing, the role is treated as absent.
4. **Role/scope grant.** The permission must be in the union of the actor's implicit roles, platform roles and seller role for the **resource's** seller.
5. **Ownership and relationship conditions.** The ◐ conditions in the table (author-only, seller owns product, block rules, …).
6. **Conflict of interest (COI).** Staff cannot decide on content they authored, content about a seller they are a member of, or appeals against their own decisions. Seller members cannot review or vote on their seller's products.
7. **Step-up.** Actions listed in ADR-0002 §4 require `reauthenticatedAt` within the last 10 minutes. Otherwise the denial reason is `STEP_UP_REQUIRED` and the UI prompts the user.

### 4. Interface and enforcement points

```ts
// packages/core/authz
type Decision =
  | { allow: true }
  | { allow: false; reason: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'RESTRICTED' | 'TWO_FACTOR_REQUIRED'
                         | 'STEP_UP_REQUIRED' | 'CONFLICT_OF_INTEREST' | 'NOT_OWNER' | 'BLOCKED' };

authorize(actor: ActorContext, permission: Permission, resource?: ResourceContext): Decision
assertAuthorized(...)  // throws, for use inside Server Actions / jobs
```

- `ActorContext` is loaded **once per request**: user, session flags, active `UserRole`s, accepted `SellerMember`s, and active enforcement restrictions. It is never cached across requests, so revocations apply immediately.
- **Every** Server Action, mutating Route Handler and worker job that acts on behalf of a user calls `assertAuthorized`. UI checks are cosmetic only.
- Reads that must hide non-public content (`PENDING`, `HIDDEN`, `REMOVED`, private media) go through repository functions that apply visibility filters. Components never call Prisma directly.
- Every allowed **staff** action, and every denial of a staff permission, writes an `AuditLog` row with an `actorRoles` snapshot.
- Automated actors (AI, RULE) act as the system principal and have a fixed, narrow permission set: they may write `ModerationDecision`s and apply auto-outcomes within configured thresholds, and may issue `WARNING` / `CONTENT_REMOVAL` only. They may never issue `SUSPENSION` or `BAN`.

### 5. Testing

- A table-driven test suite is generated from the matrix in §2. Every (role, permission) cell gets a test, plus targeted tests for each guard: restriction, 2FA gate, COI, step-up, block, and cross-seller scope.
- Changing the matrix requires updating this ADR in the same PR.

## Alternatives considered

| Option | Why not |
|---|---|
| **Permissions stored in the DB** (`Permission`, `RolePermission` tables, admin UI to edit) | Flexibility we don't need, and misconfiguration becomes a runtime risk that bypasses code review. It is also harder to test. Rejected |
| **Single `role` column on `User`** | Cannot express "member + moderator" or "responder for seller A, owner for seller B". Rejected |
| **Hierarchical roles (ADMIN ⊃ MODERATOR …)** | Blurs separation of duties (admins quietly moderating) and makes COI analysis harder. Rejected in favour of additive bundles |
| **External authorization service / ReBAC (OpenFGA, SpiceDB, Oso Cloud, Cerbos)** | Powerful, but it is another service, and relationships would have to be kept in sync for a graph that has only two levels in Phase 1. **Revisit** in Phase 2 if messaging, teams or delegated access make the relationship graph deeper |
| **Authorization library (e.g. CASL)** | Workable, but plain typed functions are easier to read in review and in the threat model. A library can still be adopted inside `authz` later without changing callers |

## Consequences

**Positive:** one enforcement point shared by web and worker; explicit separation of duties; immediate effect of enforcement actions; exhaustively testable.

**Negative:** permission changes require a deploy (intended). `ActorContext` loading costs a few indexed queries per request (acceptable, and it can be merged into the session query). COI and visibility rules are application-enforced, so they depend on the test suite and code review discipline.
