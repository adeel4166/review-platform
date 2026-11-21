import { describe, expect, it, vi } from "vitest";
import { FakeModerationDb } from "@rp/core";
import { HttpError } from "./http";

const sessionState = vi.hoisted(() => ({ role: null as null | "user" | "admin" }));
vi.mock("@/server/session", async () => {
  const { HttpError } = await import("@/server/http");
  const requireUser = async () => {
    if (!sessionState.role) throw new HttpError(401, "unauthenticated", "Sign in required");
    return { id: "a1", role: sessionState.role };
  };
  return {
    requireUser,
    requireAdmin: async () => {
      const a = await requireUser();
      if (a.role !== "admin") throw new HttpError(403, "forbidden", "Admin access required");
      return a;
    },
  };
});
const fake = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/server/db", () => ({ get db() { return fake.db; } }));

import { GET as listRoute } from "../app/api/admin/moderation/route";
import { POST as approveRoute } from "../app/api/admin/moderation/[id]/approve/route";
import { POST as rejectRoute } from "../app/api/admin/moderation/[id]/reject/route";
import { decideCase, listModerationQueue } from "./moderation";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown = {}) => new Request("http://t/x", { method: "POST", body: JSON.stringify(body) });

function setup(state = "NEEDS_HUMAN") {
  const f = new FakeModerationDb();
  const r = f.addReview({ status: "HIDDEN" });
  const c = f.addCase(r.id as string, state);
  fake.db = f;
  return { f, r, c };
}

describe("admin access control", () => {
  it.each([["signed out", null, 401], ["regular user", "user", 403]] as const)("%s is refused on every endpoint", async (_n, role, status) => {
    sessionState.role = role;
    const { c } = setup();
    expect((await listRoute(new Request("http://t/x"))).status).toBe(status);
    expect((await approveRoute(post(), ctx(c.id))).status).toBe(status);
    expect((await rejectRoute(post({ reason: "spam" }), ctx(c.id))).status).toBe(status);
    expect(c.state).toBe("NEEDS_HUMAN");
  });
});

describe("admin decisions", () => {
  it("approve publishes and writes an audit entry", async () => {
    sessionState.role = "admin";
    const { f, r, c } = setup();
    const res = await approveRoute(post({ reason: "looks fine" }), ctx(c.id));
    expect(res.status).toBe(200);
    expect(r.status).toBe("PUBLISHED");
    expect(f.audit).toHaveLength(1);
    expect(f.audit[0]).toMatchObject({ actorType: "STAFF", actorId: "a1", action: "review.approve" });
  });
  it("reject requires a reason, then rejects with audit", async () => {
    sessionState.role = "admin";
    const { f, r, c } = setup();
    expect((await rejectRoute(post({}), ctx(c.id))).status).toBe(400);
    expect((await rejectRoute(post({ reason: "spam" }), ctx(c.id))).status).toBe(200);
    expect(r.status).toBe("REJECTED");
    expect(f.audit[0]).toMatchObject({ action: "review.reject", metadata: expect.objectContaining({ reason: "spam" }) });
  });
  it("illegal transitions are 409 (decided or still in AI review), unknown case 404", async () => {
    sessionState.role = "admin";
    for (const s of ["APPROVED", "REJECTED", "AI_REVIEW", "PENDING"]) {
      const { c, f } = setup(s);
      expect((await approveRoute(post(), ctx(c.id))).status).toBe(409);
      expect((await rejectRoute(post({ reason: "nope" }), ctx(c.id))).status).toBe(409);
      expect(f.audit).toHaveLength(0);
    }
    setup();
    expect((await approveRoute(post(), ctx("missing"))).status).toBe(404);
  });
  it("decideCase maps errors to HttpError", async () => {
    const { f } = setup("APPROVED");
    await expect(decideCase(f as never, { id: "a", role: "admin" }, "c2", "APPROVED")).rejects.toBeInstanceOf(HttpError);
  });
});

describe("queue listing", () => {
  it("defaults to NEEDS_HUMAN, applies filters and paginates", async () => {
    sessionState.role = "admin";
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    await listModerationQueue({ moderationCase: { findMany, count } } as never, { state: "NEEDS_HUMAN", productId: "p1", minScore: 0.3, page: 2, pageSize: 10 });
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { state: "NEEDS_HUMAN", review: { productId: "p1" }, aiScore: { gte: 0.3 } }, skip: 10, take: 10,
    });
    fake.db = { moderationCase: { findMany, count } };
    expect((await listRoute(new Request("http://t/x?state=BOGUS"))).status).toBe(400);
    expect((await listRoute(new Request("http://t/x"))).status).toBe(200);
    expect(findMany.mock.calls.at(-1)![0].where.state).toBe("NEEDS_HUMAN");
  });
});
