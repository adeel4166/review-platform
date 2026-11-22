# ADR-0032: M7 social and comparison scope: follows, blocks and public profiles; stateless comparison of up to 4 products; comments, posts and likes deferred; no messaging

| | |
|---|---|
| **Status** | Proposed. Becomes *Accepted* when merged to `main` with CEO approval |
| **Date** | 2026-11-22 |
| **Deciders** | Software Architect (author). CEO (approval) |
| **Task** | #77 (M6–M8 spec) |
| **Related** | ADR-0003 §2 (`follow.create`, `comment.create`, `post.create`, `like.create`, `comparison.manage.own`, no `message.*`) · wireframes 05, 06 · threat-model D-4, F-10 · [m6-m8-spec.md §18–§20](../architecture/m6-m8-spec.md#18-social-profile-follows-blocks-adr-0032) · catalogue `TRS-006`, `TRS-010`, `AZ-014`, `SCOPE-001` |

## Context

The draft schema and ADR-0003 include `Comment`, `Post`, `Like`, `Follow`, `UserBlock`, `Comparison` and
`WishlistItem`. Wireframe 06 limits Phase 1 social to "follow users, follow products/sellers, helpful votes, reports,
public profile" plus Block, and has **no** wireframe for comments, posts or likes. Wireframe 05 describes a compare
tray and a shareable `/compare?p=a,b,c` URL, not saved comparisons. Messaging is Phase 2 (`SCOPE-001`).

## Decision

1. **In M7:** `Follow` (user, seller or product; exclusive arc), `UserBlock`, public profile `/u/{handle}`, own
   profile tabs, notifications (ADR-0031). Blocking removes follows in both directions, hides the blocker's content
   interactions from the blocked user's notifications, and denies `follow.create` (`BLOCKED`).
2. **Comparison is stateless:** the tray lives in the browser (`localStorage`), the share link is the URL, and the
   server exposes one read endpoint `GET /api/compare?ids=` for 2–4 distinct products. No `Comparison` /
   `ComparisonItem` tables and no `comparison.manage.own` routes in Phase 1 (the permission stays in the matrix, unused,
   so `AZ-001` does not change). Price range and "pros/cons themes" rows are **not** shown in Phase 1 (no price data in
   the catalogue; themes need a text-mining job that does not exist).
3. **Deferred to Phase 1.x (after M8):** `Comment`, `Post`, `Like`, `WishlistItem`. Their permissions stay in the
   matrix. `AZ-014` is asserted in M7 for `follow.create` only; its comment/like clauses move with the feature.
   Moderation config keeps the `COMMENT`/`POST` content types so the pipeline needs no change later.
4. **No messaging (`SCOPE-001`, re-run at the M7 gate):** a static test fails if any permission matches `message.*`,
   any route path matches `/messag|conversation|inbox\/thread|dm/i`, any Prisma model or table matches
   `Message|Conversation|Thread`, any `NotificationType` starts with `MESSAGE`, or any UI string key contains
   `message.send`/`message.compose`. The notification inbox route is `/notifications`, not `/inbox`, to keep the
   pattern simple.

## Alternatives considered

| Option | Why not |
|---|---|
| Build comments/posts/likes in M7 as the draft schema allows | No UX design, a fourth moderated content type, and more spam surface (F-10) before launch; nothing in the gate needs them |
| Saved comparisons on the server | No wireframe; the URL already shares; adds a table and a permission path to test |
| Defer follows too | Wireframe 06 and the `NEW_FOLLOWER` / `FOLLOWED_PRODUCT_REVIEWED` notifications depend on them |

## Consequences

**Positive:** M7 stays inside what is designed and gated; the deferred features keep their schema plan.

**Negative / risks:** the product description's "social features" are thinner at launch. Product must confirm (open
question M68-Q12).

## Follow-ups

- Product: confirm the deferral; design wireframes for comments/posts before scheduling them.
