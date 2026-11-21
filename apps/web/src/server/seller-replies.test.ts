import { beforeEach, describe, expect, it } from "vitest";
import { findPiiAuditKeys } from "@rp/core";
import { HttpError } from "./http";
import { createReply, deleteReply, editReply, issueReplyRestriction, liftReplyRestriction, publicRepliesFor, removeReply } from "./seller-replies";
import { replyInput } from "./validation";
import type { Actor } from "./session";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function match(r: Row, w: Row = {}): boolean {
  return Object.entries(w).every(([k, v]) => {
    if (k === "OR") return (v as Row[]).some((x) => match(r, x));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gt" in v) return r[k] != null && r[k] > v.gt;
      if ("lte" in v) return r[k] != null && r[k] <= v.lte;
      if ("in" in v) return v.in.includes(r[k]);
      if (k === "sellerId_userId") return r.sellerId === v.sellerId && r.userId === v.userId;
      if (k === "reviewId_sellerId") return r.reviewId === v.reviewId && r.sellerId === v.sellerId;
      if (r[k] && typeof r[k] === "object") return match(r[k], v); // nested relation filter
      return false;
    }
    return (r[k] ?? null) === v;
  });
}
const cp = (r: Row | undefined) => (r ? { ...r } : null);

function makeDb() {
  const t: Record<string, Row[]> = { user: [], seller: [], sellerMember: [], enforcementAction: [], review: [], product: [], sellerReply: [], auditLog: [], outboxEvent: [] };
  let n = 0;
  const table = (name: string, extra: (r: Row) => Row = (r) => r, defaults: Row = {}) => ({
    findUnique: async ({ where }: Row) => cp(t[name]!.map(extra).find((r) => match(r, where))),
    findFirst: async ({ where }: Row) => cp(t[name]!.map(extra).find((r) => match(r, where))),
    findMany: async ({ where }: Row) => t[name]!.map(extra).filter((r) => match(r, where)).map((r) => ({ ...r })),
    count: async ({ where }: Row = {}) => t[name]!.filter((r) => match(r, where)).length,
    create: async ({ data }: Row) => { const row = { id: `${name}${++n}`, createdAt: new Date(), ...defaults, ...data }; t[name]!.push(row); return { ...row }; },
    updateMany: async ({ where, data }: Row) => { const rows = t[name]!.filter((r) => match(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
  });
  const db = {
    user: table("user"), seller: table("seller"), sellerMember: table("sellerMember"), enforcementAction: table("enforcementAction", (r) => r, { status: "ACTIVE" }),
    review: table("review", (r) => ({ ...r, product: { sellerId: t.product!.find((p) => p.id === r.productId)?.sellerId ?? null } })),
    sellerReply: table("sellerReply", (r) => ({
      ...r,
      seller: { ...t.seller!.find((x) => x.id === r.sellerId), name: "Seller", slug: "seller" },
      review: { product: { sellerId: t.product!.find((p) => p.id === t.review!.find((x) => x.id === r.reviewId)?.productId)?.sellerId ?? null } },
    })),
    auditLog: table("auditLog"), outboxEvent: table("outboxEvent"),
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db: db as never, t };
}

const NOW = new Date("2026-11-21T12:00:00Z");
const actor = (id: string, role: Actor["role"] = "user", twoFactor = true): Actor => ({ id, role, twoFactor: { enrolled: twoFactor, verified: twoFactor } });
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: HttpError) => `${e.status}:${e.code}`);
const GOOD = "Thank you for the feedback, we are sorry about this. Please use the in-app help to start a return.";

let h: ReturnType<typeof makeDb>;
beforeEach(() => {
  h = makeDb();
  for (const u of ["ownerA", "managerA", "responderA", "responderA2", "ownerB", "reviewer", "outsider", "admin1", "adminMemberA"]) h.t.user!.push({ id: u, status: "ACTIVE" });
  h.t.seller!.push({ id: "A", status: "VERIFIED" }, { id: "B", status: "VERIFIED" });
  h.t.sellerMember!.push(
    { sellerId: "A", userId: "ownerA", role: "OWNER" }, { sellerId: "A", userId: "managerA", role: "MANAGER" }, { sellerId: "A", userId: "responderA", role: "RESPONDER" },
    { sellerId: "A", userId: "responderA2", role: "RESPONDER" }, { sellerId: "A", userId: "adminMemberA", role: "RESPONDER" }, { sellerId: "B", userId: "ownerB", role: "OWNER" },
  );
  h.t.product!.push({ id: "pA", sellerId: "A" }, { id: "pB", sellerId: "B" }, { id: "pNone", sellerId: null });
  h.t.review!.push(
    { id: "rA", productId: "pA", authorId: "reviewer", status: "PUBLISHED" }, { id: "rB", productId: "pB", authorId: "reviewer", status: "PUBLISHED" },
    { id: "rNone", productId: "pNone", authorId: "reviewer", status: "PUBLISHED" }, { id: "rPending", productId: "pA", authorId: "reviewer", status: "PENDING" },
    { id: "rOwn", productId: "pA", authorId: "responderA", status: "PUBLISHED" },
  );
});
const body = { body: GOOD };

describe("cross-seller authz on create, table-driven (RPL-002, P-2)", () => {
  const members = [["ownerA", "OWNER"], ["managerA", "MANAGER"], ["responderA", "RESPONDER"]] as const;
  for (const [uid, role] of members) {
    it(`${role} of A replies on A's product (201, PENDING, outbox + audit, no body in audit)`, async () => {
      const r = await createReply(h.db, actor(uid), "rA", body, { now: NOW });
      expect(r).toMatchObject({ status: "PENDING", version: 1 });
      expect(h.t.sellerReply![0]).toMatchObject({ reviewId: "rA", sellerId: "A", authorId: uid, status: "PENDING" });
      expect(h.t.outboxEvent![0]).toMatchObject({ type: "seller_reply.submitted", payload: { subjectType: "SELLER_REPLY", version: 1 } });
      expect(JSON.stringify(h.t.outboxEvent) + JSON.stringify(h.t.auditLog)).not.toContain("Thank you");
      expect(findPiiAuditKeys(h.t.auditLog![0]!.metadata)).toEqual([]);
    });
    it(`${role} of A on a review of B's product is 404 and writes nothing`, async () => {
      expect(await code(createReply(h.db, actor(uid), "rB", body, { now: NOW }))).toBe("404:not_found");
      expect(h.t.sellerReply).toHaveLength(0);
    });
  }
  it("a non-member and a seller B owner on A's review are 404; unclaimed product and unknown review are 404", async () => {
    for (const [uid, rid] of [["outsider", "rA"], ["ownerB", "rA"], ["ownerA", "rNone"], ["ownerA", "nope"]] as const) {
      expect(await code(createReply(h.db, actor(uid), rid, body, { now: NOW }))).toBe("404:not_found");
    }
  });
  it("the request body cannot carry sellerId, productId or reviewId (strict schema)", () => {
    for (const extra of [{ sellerId: "B" }, { productId: "pB" }, { reviewId: "rB" }]) expect(() => replyInput.parse({ ...body, ...extra })).toThrow();
  });
  it("the review's author cannot reply as a seller member; unpublished review is 409", async () => {
    expect(await code(createReply(h.db, actor("responderA"), "rOwn", body, { now: NOW }))).toBe("403:CONFLICT_OF_INTEREST");
    expect(await code(createReply(h.db, actor("ownerA"), "rPending", body, { now: NOW }))).toBe("409:review_not_replyable");
  });
  it("OWNER/MANAGER without a verified 2FA session are denied; RESPONDER is not (RPL-009)", async () => {
    expect(await code(createReply(h.db, actor("ownerA", "user", false), "rA", body, { now: NOW }))).toBe("403:TWO_FACTOR_REQUIRED");
    expect(await code(createReply(h.db, actor("managerA", "user", false), "rA", body, { now: NOW }))).toBe("403:TWO_FACTOR_REQUIRED");
    expect(await code(createReply(h.db, actor("responderA", "user", false), "rA", body, { now: NOW }))).toBe("ok");
  });
  it("the same seller cannot reply twice to one review (409)", async () => {
    await createReply(h.db, actor("ownerA"), "rA", body, { now: NOW });
    expect(await code(createReply(h.db, actor("managerA"), "rA", body, { now: NOW }))).toBe("409:already_replied");
  });
});

describe("seller state gates (RPL-003)", () => {
  for (const [status, expected] of [["UNVERIFIED", "403:SELLER_NOT_VERIFIED"], ["PENDING_VERIFICATION", "403:SELLER_NOT_VERIFIED"], ["CLOSED", "403:SELLER_NOT_VERIFIED"], ["VERIFIED", "ok"]] as const) {
    it(`seller ${status} -> ${expected}`, async () => {
      h.t.seller![0]!.status = status;
      expect(await code(createReply(h.db, actor("ownerA"), "rA", body, { now: NOW }))).toBe(expected);
    });
  }
  it("an active SELLER_SUSPENSION denies with SELLER_SUSPENDED", async () => {
    h.t.enforcementAction!.push({ id: "s1", type: "SELLER_SUSPENSION", status: "ACTIVE", subjectSellerId: "A", startsAt: new Date("2026-01-01"), endsAt: null });
    expect(await code(createReply(h.db, actor("ownerA"), "rA", body, { now: NOW }))).toBe("403:SELLER_SUSPENDED");
  });
});

describe("content policy on create and edit (RPL-001)", () => {
  const rejected: Array<[string, string]> = [
    ["https link", "Refund here https://evil.test/x"], ["bare domain", "Visit brand.com now"], ["www", "see www.brand today"],
    ["obfuscated dot", "brand[.]com"], ["email", "mail jane@brand.com please"], ["html", "<b>sorry</b>"], ["markdown link", "[here](x)"],
    ["bidi", "abc‮def"], ["too long", "a".repeat(1501)], ["empty", "   "],
  ];
  for (const [name, text] of rejected) {
    it(`create rejects ${name} with 422 and stores nothing`, async () => {
      expect(await code(createReply(h.db, actor("ownerA"), "rA", { body: text }, { now: NOW }))).toBe("422:reply_policy_violation");
      expect(h.t.sellerReply).toHaveLength(0);
      expect(h.t.outboxEvent).toHaveLength(0);
    });
  }
  it("the 422 body names the reasons", async () => {
    const e = await createReply(h.db, actor("ownerA"), "rA", { body: "x https://a.test jane@b.co" }, { now: NOW }).catch((x: HttpError) => x);
    expect((e as HttpError).details).toEqual({ reasons: expect.arrayContaining(["link", "email"]) });
  });
  it("edit rejects a link and keeps the old text and version", async () => {
    const { id } = await createReply(h.db, actor("ownerA"), "rA", body, { now: NOW });
    expect(await code(editReply(h.db, actor("ownerA"), id, { body: "now https://x.test" }, { now: NOW }))).toBe("422:reply_policy_violation");
    expect(h.t.sellerReply![0]).toMatchObject({ body: GOOD, version: 1 });
  });
  it("soft-flagged text (phone) is accepted; moderation forces a human later", async () => {
    expect(await code(createReply(h.db, actor("ownerA"), "rA", { body: "Call +49 151 1234 5678" }, { now: NOW }))).toBe("ok");
  });
  it("rate limit hook runs after authorization and before the policy (429 wins over 422, 404 wins over 429)", async () => {
    const limited = { now: NOW, rateLimit: async () => { throw new HttpError(429, "rate_limited"); } };
    expect(await code(createReply(h.db, actor("ownerA"), "rA", { body: "https://x.test" }, limited))).toBe("429:rate_limited");
    expect(await code(createReply(h.db, actor("outsider"), "rA", body, limited))).toBe("404:not_found");
  });
});

describe("edit, delete, reuse lifecycle (RPL-007)", () => {
  it("editing a PUBLISHED reply makes it non-public (PENDING, version + 1) and enqueues moderation", async () => {
    const { id } = await createReply(h.db, actor("ownerA"), "rA", body, { now: NOW });
    Object.assign(h.t.sellerReply![0]!, { status: "PUBLISHED", publishedAt: NOW });
    expect(await publicRepliesFor(h.db, "A", ["rA"])).toHaveProperty("size", 1);
    expect(await editReply(h.db, actor("ownerA"), id, { body: "Updated answer for you." }, { now: NOW })).toMatchObject({ status: "PENDING", version: 2 });
    expect(await publicRepliesFor(h.db, "A", ["rA"])).toHaveProperty("size", 0);
    expect(h.t.outboxEvent!.at(-1)).toMatchObject({ type: "seller_reply.edited", payload: { subjectId: id, version: 2 } });
  });
  it("REMOVED cannot be edited or deleted", async () => {
    const { id } = await createReply(h.db, actor("ownerA"), "rA", body, { now: NOW });
    h.t.sellerReply![0]!.status = "REMOVED";
    expect(await code(editReply(h.db, actor("ownerA"), id, body, { now: NOW }))).toBe("409:reply_removed");
    expect(await code(deleteReply(h.db, actor("ownerA"), id, NOW))).toBe("409:reply_removed");
  });
  it("a reply after DELETED reuses the row with version + 1", async () => {
    const { id } = await createReply(h.db, actor("ownerA"), "rA", body, { now: NOW });
    await deleteReply(h.db, actor("ownerA"), id, NOW);
    expect(h.t.sellerReply![0]).toMatchObject({ status: "DELETED", deletedById: "ownerA" });
    const again = await createReply(h.db, actor("managerA"), "rA", body, { now: NOW });
    expect(again).toMatchObject({ id, version: 2, status: "PENDING" });
    expect(h.t.sellerReply).toHaveLength(1);
    expect(h.t.sellerReply![0]).toMatchObject({ deletedAt: null, deletedById: null, authorId: "managerA" });
  });
  it("RESPONDER edits only their own reply; OWNER/MANAGER any reply of the seller; seller B members never", async () => {
    const { id } = await createReply(h.db, actor("responderA"), "rA", body, { now: NOW });
    expect(await code(editReply(h.db, actor("responderA2"), id, body, { now: NOW }))).toBe("403:FORBIDDEN_ROLE");
    expect(await code(deleteReply(h.db, actor("responderA2"), id, NOW))).toBe("403:FORBIDDEN_ROLE");
    expect(await code(editReply(h.db, actor("ownerB"), id, body, { now: NOW }))).toBe("404:not_found");
    expect(await code(deleteReply(h.db, actor("ownerB"), id, NOW))).toBe("404:not_found");
    expect(await code(editReply(h.db, actor("managerA"), id, body, { now: NOW }))).toBe("ok");
  });
  it("when the product changed hands only delete is allowed", async () => {
    const { id } = await createReply(h.db, actor("ownerA"), "rA", body, { now: NOW });
    h.t.product![0]!.sellerId = "B";
    expect(await code(editReply(h.db, actor("ownerA"), id, body, { now: NOW }))).toBe("409:reply_not_editable");
    expect(await code(deleteReply(h.db, actor("ownerA"), id, NOW))).toBe("ok");
  });
  it("edit rate limit is keyed per reply and receives the reply id", async () => {
    const { id } = await createReply(h.db, actor("ownerA"), "rA", body, { now: NOW });
    const seen: unknown[] = [];
    await editReply(h.db, actor("ownerA"), id, body, { now: NOW, rateLimit: async (c) => { seen.push(c); } });
    expect(seen).toEqual([{ sellerId: "A", replyId: id }]);
  });
});

describe("SELLER_REPLY_RESTRICTION (RPL-004)", () => {
  const restriction = (over: Row) => h.t.enforcementAction!.push({ id: `e${h.t.enforcementAction!.length}`, type: "SELLER_REPLY_RESTRICTION", status: "ACTIVE", startsAt: new Date("2026-01-01"), endsAt: null, ...over });
  for (const [label, subject] of [["seller-level", { subjectSellerId: "A" }], ["user-level", { subjectUserId: "ownerA" }]] as const) {
    it(`${label} restriction blocks create and edit, not delete; expiry restores`, async () => {
      const { id } = await createReply(h.db, actor("ownerA"), "rA", body, { now: NOW });
      restriction(subject);
      h.t.review!.push({ id: "rX", productId: "pA", authorId: "reviewer", status: "PUBLISHED" });
      expect(await code(createReply(h.db, actor("ownerA"), "rX", body, { now: NOW }))).toBe("403:REPLY_RESTRICTED");
      expect(await code(editReply(h.db, actor("ownerA"), id, body, { now: NOW }))).toBe("403:REPLY_RESTRICTED");
      expect(await code(deleteReply(h.db, actor("ownerA"), id, NOW))).toBe("ok");
      h.t.enforcementAction![0]!.endsAt = new Date("2026-11-21T11:00:00Z"); // expired an hour ago
      expect(await code(createReply(h.db, actor("ownerA"), "rX", body, { now: NOW }))).toBe("ok");
    });
  }
  it("a user-level restriction only affects that user, a REVOKED one affects nobody", async () => {
    restriction({ subjectUserId: "ownerA" });
    expect(await code(createReply(h.db, actor("managerA"), "rA", body, { now: NOW }))).toBe("ok");
    h.t.enforcementAction![0]!.status = "REVOKED";
    h.t.review!.push({ id: "rY", productId: "pA", authorId: "reviewer", status: "PUBLISHED" });
    expect(await code(createReply(h.db, actor("ownerA"), "rY", body, { now: NOW }))).toBe("ok");
  });
  it("issue and lift: ADMIN only, issuer COI refused (seller and user subject), writes audit", async () => {
    expect(await code(issueReplyRestriction(h.db, actor("outsider"), { sellerId: "A" }, { reasonCode: "ABUSE", publicReason: "abusive replies" }, NOW))).toBe("403:forbidden");
    expect(await code(issueReplyRestriction(h.db, actor("adminMemberA", "admin"), { sellerId: "A" }, { reasonCode: "ABUSE", publicReason: "abusive replies" }, NOW))).toBe("403:CONFLICT_OF_INTEREST");
    expect(await code(issueReplyRestriction(h.db, actor("adminMemberA", "admin"), { userId: "ownerA" }, { reasonCode: "ABUSE", publicReason: "abusive replies" }, NOW))).toBe("403:CONFLICT_OF_INTEREST");
    expect(await code(issueReplyRestriction(h.db, actor("admin1", "admin"), { sellerId: "nope" }, { reasonCode: "ABUSE", publicReason: "abusive replies" }, NOW))).toBe("404:not_found");
    const { enforcementId } = await issueReplyRestriction(h.db, actor("admin1", "admin"), { sellerId: "A" }, { reasonCode: "ABUSE", publicReason: "abusive replies" }, NOW);
    expect(await code(createReply(h.db, actor("ownerA"), "rA", body, { now: NOW }))).toBe("403:REPLY_RESTRICTED");
    expect(await code(liftReplyRestriction(h.db, actor("adminMemberA", "admin"), enforcementId, NOW))).toBe("403:CONFLICT_OF_INTEREST");
    await liftReplyRestriction(h.db, actor("admin1", "admin"), enforcementId, NOW);
    expect(await code(createReply(h.db, actor("ownerA"), "rA", body, { now: NOW }))).toBe("ok");
    expect(h.t.auditLog!.map((a) => a.action)).toEqual(expect.arrayContaining(["enforcement.issued", "enforcement.revoked"]));
  });
});

describe("public rendering rule (RPL-006) and staff removal", () => {
  beforeEach(async () => {
    await createReply(h.db, actor("ownerA"), "rA", body, { now: NOW });
    Object.assign(h.t.sellerReply![0]!, { status: "PUBLISHED", publishedAt: NOW });
  });
  it("shown only when PUBLISHED, sellerId = product.sellerId and the seller is VERIFIED; DTO has no author", async () => {
    const m = await publicRepliesFor(h.db, "A", ["rA"]);
    expect(m.get("rA")).toBeDefined();
    expect(Object.keys(m.get("rA")!).sort()).toEqual(["body", "editedAt", "publishedAt", "seller"]);
  });
  it("hidden for non-PUBLISHED status, an unclaimed or re-assigned product", async () => {
    expect((await publicRepliesFor(h.db, null, ["rA"])).size).toBe(0);
    expect((await publicRepliesFor(h.db, "B", ["rA"])).size).toBe(0);
    for (const s of ["PENDING", "HIDDEN", "REJECTED", "REMOVED", "DELETED"]) {
      h.t.sellerReply![0]!.status = s;
      expect((await publicRepliesFor(h.db, "A", ["rA"])).size).toBe(0);
    }
  });
  it("staff removal: admin non-member only, PUBLISHED only, audits without the body", async () => {
    expect(await code(removeReply(h.db, actor("outsider"), "sellerReply1", { reasonCode: "ABUSE" }))).toBe("403:forbidden");
    expect(await code(removeReply(h.db, actor("adminMemberA", "admin"), "sellerReply1", { reasonCode: "ABUSE" }))).toBe("403:CONFLICT_OF_INTEREST");
    expect(await code(removeReply(h.db, actor("admin1", "admin"), "sellerReply1", { reasonCode: "ABUSE" }))).toBe("ok");
    expect(h.t.sellerReply![0]!.status).toBe("REMOVED");
    expect(await code(removeReply(h.db, actor("admin1", "admin"), "sellerReply1", { reasonCode: "ABUSE" }))).toBe("409:illegal_transition");
    expect(JSON.stringify(h.t.auditLog)).not.toContain("Thank you");
  });
});
