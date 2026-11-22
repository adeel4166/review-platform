import { describe, expect, it } from "vitest";
import { grantStaffRole, revokeStaffRole } from "./staff-roles";
import type { Actor } from "./session";

/** AZ-028 / T-06 guards for grantStaffRole and the SUPER_ADMIN floor in revokeStaffRole. */
function fakeDb(o: { user?: Record<string, unknown> | null; tfConfirmed?: boolean; superAdmins?: number } = {}) {
  const calls: string[] = [];
  const tx = {
    user: { findUnique: async () => (o.user === undefined ? { id: "T", status: "ACTIVE", emailVerifiedAt: new Date() } : o.user) },
    twoFactorTotp: { findUnique: async () => (o.tfConfirmed === false ? { confirmedAt: null } : { confirmedAt: new Date() }) },
    userSession: { updateMany: async () => { calls.push("revoke_sessions"); } },
    userRole: {
      upsert: async () => { calls.push("upsert"); },
      deleteMany: async () => ({ count: 1 }),
      count: async () => o.superAdmins ?? 3,
    },
    auditLog: { create: async () => { calls.push("audit"); } },
    $queryRaw: async () => [],
  };
  return { calls, db: { $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) } };
}
const sa: Actor = { id: "SA", role: "super_admin" };
const err = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { const x = e as { status?: number; code?: string }; return `${x.status}:${x.code}`; } };

describe("grantStaffRole T-06 guards (AZ-028)", () => {
  it("only a SUPER_ADMIN may grant; self-grant refused", async () => {
    const f = fakeDb();
    expect(await err(grantStaffRole(f.db, { id: "AD", role: "admin" }, "T", "MODERATOR", "r"))).toBe("403:forbidden");
    expect(await err(grantStaffRole(f.db, sa, "SA", "MODERATOR", "r"))).toBe("403:forbidden");
    expect(f.calls).toEqual([]);
  });
  it("unknown target -> 404", async () => {
    expect(await err(grantStaffRole(fakeDb({ user: null }).db, sa, "T", "MODERATOR", "r"))).toBe("404:not_found");
  });
  it("non-ACTIVE or unverified target is refused", async () => {
    for (const user of [{ id: "T", status: "SUSPENDED", emailVerifiedAt: new Date() }, { id: "T", status: "ACTIVE", emailVerifiedAt: null }]) {
      const f = fakeDb({ user });
      expect(await err(grantStaffRole(f.db, sa, "T", "ADMIN", "r"))).toBe("409:target_not_eligible");
      expect(f.calls).toEqual([]);
    }
  });
  it("target without confirmed 2FA is refused", async () => {
    const f = fakeDb({ tfConfirmed: false });
    expect(await err(grantStaffRole(f.db, sa, "T", "ADMIN", "r"))).toBe("409:target_two_factor_missing");
    expect(f.calls).toEqual([]);
  });
  it("an eligible target gets the role, sessions revoked and an audit row", async () => {
    const f = fakeDb();
    expect(await grantStaffRole(f.db, sa, "T", "ADMIN", "r")).toEqual({ userId: "T", role: "ADMIN" });
    expect(f.calls).toEqual(["upsert", "revoke_sessions", "audit"]);
  });
});

describe("revokeStaffRole SUPER_ADMIN floor (AZ-028)", () => {
  it("cannot drop below 2 SUPER_ADMINs", async () => {
    expect(await err(revokeStaffRole(fakeDb({ superAdmins: 2 }).db, sa, "T", "SUPER_ADMIN"))).toBe("409:conflict");
    expect(await err(revokeStaffRole(fakeDb({ superAdmins: 3 }).db, sa, "T", "SUPER_ADMIN"))).toBe("ok");
  });
});
