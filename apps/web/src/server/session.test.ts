import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("./auth", () => ({ auth: () => authMock() }));

import { requireAdmin, requireUser } from "./session";

describe("requireUser / requireAdmin fail closed", () => {
  beforeEach(() => authMock.mockReset());

  it("returns the actor for a valid session", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "user" } });
    await expect(requireUser()).resolves.toEqual({ id: "u1", role: "user" });
  });

  it.each([
    ["null session", null],
    ["no user", {}],
    ["empty id", { user: { id: "", role: "admin" } }],
    ["blank id", { user: { id: "  ", role: "admin" } }],
    ["numeric id", { user: { id: 1, role: "admin" } }],
    ["error-populated object", { error: "RefreshAccessTokenError", user: { id: "u1", role: "admin" } }],
  ])("rejects %s with 401", async (_n, session) => {
    authMock.mockResolvedValue(session);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 });
  });

  it("requireAdmin returns 403 for non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "user" } });
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });
});
