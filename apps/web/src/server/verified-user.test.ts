import { describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({ requireUser: vi.fn(async () => ({ id: "u1", role: "user" })) }));
vi.mock("./db", () => ({ db: {} }));
import { requireVerifiedUser } from "./verified-user";

const dbWith = (v: Date | null | undefined) => ({ user: { findUnique: vi.fn(async () => (v === undefined ? null : { emailVerifiedAt: v })) } }) as never;

describe("requireVerifiedUser", () => {
  it("403 EMAIL_NOT_VERIFIED for an unverified or missing user", async () => {
    await expect(requireVerifiedUser(dbWith(null))).rejects.toMatchObject({ status: 403, code: "EMAIL_NOT_VERIFIED" });
    await expect(requireVerifiedUser(dbWith(undefined))).rejects.toMatchObject({ status: 403 });
  });
  it("returns the actor for a verified user", async () => {
    await expect(requireVerifiedUser(dbWith(new Date()))).resolves.toEqual({ id: "u1", role: "user" });
  });
});
