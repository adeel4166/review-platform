import { describe, expect, it } from "vitest";
import { revokeStaffRole } from "./staff-roles";
import type { Actor } from "./session";

/** AZ-028 SUPER_ADMIN floor in revokeStaffRole. Grants moved to approvals.ts/requestRoleGrant (SEC-M6-01, see m6.int.test.ts). */
function fakeDb(o: { superAdmins?: number } = {}) {
  const calls: string[] = [];
  const tx = {
    userSession: { updateMany: async () => { calls.push("revoke_sessions"); } },
    userRole: {
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

describe("revokeStaffRole SUPER_ADMIN floor (AZ-028)", () => {
  it("cannot drop below 2 SUPER_ADMINs", async () => {
    expect(await err(revokeStaffRole(fakeDb({ superAdmins: 2 }).db, sa, "T", "SUPER_ADMIN"))).toBe("409:conflict");
    expect(await err(revokeStaffRole(fakeDb({ superAdmins: 3 }).db, sa, "T", "SUPER_ADMIN"))).toBe("ok");
  });
});
