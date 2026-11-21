import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", async () => {
  const { HttpError } = await import("@/server/http");
  return { requireUser: vi.fn(async () => { throw new HttpError(401, "unauthenticated", "Sign in required"); }) };
});
vi.mock("@/server/db", () => ({ db: {} }));

import { POST as createReviewRoute } from "../app/api/products/[id]/reviews/route";
import { PATCH, DELETE } from "../app/api/reviews/[id]/route";

const ctx = { params: Promise.resolve({ id: "x" }) };
const req = (method: string, body?: unknown) =>
  new Request("http://t/api", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("write routes require authentication", () => {
  it("POST review -> 401", async () => expect((await createReviewRoute(req("POST", {}), ctx)).status).toBe(401));
  it("PATCH review -> 401", async () => expect((await PATCH(req("PATCH", {}), ctx)).status).toBe(401));
  it("DELETE review -> 401", async () => expect((await DELETE(req("DELETE"), ctx)).status).toBe(401));
});
