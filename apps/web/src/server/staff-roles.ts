import { assertAuditMetadataClean, systemClock } from "@rp/core";
import type { Prisma } from "@rp/db";
import { HttpError } from "./http";
import type { Actor } from "./session";

type Role = "MODERATOR" | "SENIOR_MODERATOR" | "ADMIN" | "SUPER_ADMIN";

interface Db {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
interface Tx {
  userSession: { updateMany(a: unknown): Promise<unknown> };
  userRole: {
    deleteMany(a: unknown): Promise<{ count: number }>;
    count(a: unknown): Promise<number>;
  };
  auditLog: { create(a: unknown): Promise<unknown> };
}

/** Role GRANTS live in approvals.ts (requestRoleGrant, four-eyes); this module only revokes. */
/** Audit metadata must carry ids and enum values only: no email, IP or name (SEC-09c; enforced by audit-metadata.test.ts). */
function audit(tx: Tx, actor: Actor, action: string, targetId: string, metadata: Prisma.InputJsonValue) {
  assertAuditMetadataClean(metadata);
  return tx.auditLog.create({ data: { actorType: "STAFF", actorId: actor.id, action, entityType: "User", entityId: targetId, metadata } });
}

const revokeTargetSessions = (tx: Tx, userId: string) =>
  tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: systemClock.now(), revokeReason: "role_changed" } });

export async function revokeStaffRole(db: unknown, actor: Actor, targetId: string, role: Role) {
  if (actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Super admin access required");
  if (actor.id === targetId) throw new HttpError(403, "forbidden", "Cannot change your own roles");
  return (db as Db).$transaction(async (tx) => {
    // Concurrent revocations serialise on the SUPER_ADMIN rows (T-06), so the floor of 2 cannot be raced below.
    if (role === "SUPER_ADMIN") await (tx as unknown as { $queryRaw(s: TemplateStringsArray): Promise<unknown> }).$queryRaw`SELECT userId FROM user_roles WHERE role = 'SUPER_ADMIN' FOR UPDATE`;
    if (role === "SUPER_ADMIN" && (await tx.userRole.count({ where: { role: "SUPER_ADMIN" } })) <= 2) {
      throw new HttpError(409, "conflict", "At least 2 SUPER_ADMINs must remain");
    }
    const r = await tx.userRole.deleteMany({ where: { userId: targetId, role } });
    if (r.count === 0) throw new HttpError(404, "not_found", "Role not assigned");
    await revokeTargetSessions(tx, targetId);
    await audit(tx, actor, "role.revoked", targetId, { role });
    return { userId: targetId, role };
  });
}
