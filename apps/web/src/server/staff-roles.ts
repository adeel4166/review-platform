import { assertAuditMetadataClean } from "@rp/core";
import type { Prisma } from "@rp/db";
import { HttpError } from "./http";
import type { Actor } from "./session";

type Role = "MODERATOR" | "SENIOR_MODERATOR" | "ADMIN" | "SUPER_ADMIN";

interface Db {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
interface Tx {
  user: { findUnique(a: unknown): Promise<{ id: string } | null> };
  userRole: {
    upsert(a: unknown): Promise<unknown>;
    deleteMany(a: unknown): Promise<{ count: number }>;
    count(a: unknown): Promise<number>;
  };
  auditLog: { create(a: unknown): Promise<unknown> };
}

/** Audit metadata must carry ids and enum values only: no email, IP or name (SEC-09c; enforced by audit-metadata.test.ts). */
function audit(tx: Tx, actor: Actor, action: string, targetId: string, metadata: Prisma.InputJsonValue) {
  assertAuditMetadataClean(metadata);
  return tx.auditLog.create({ data: { actorType: "STAFF", actorId: actor.id, action, entityType: "User", entityId: targetId, metadata } });
}

/** Caller must already have passed requireSuperAdmin(); this re-checks defensively and applies the guards from ADR-0003. */
export async function grantStaffRole(db: unknown, actor: Actor, targetId: string, role: Role, reason: string) {
  if (actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Super admin access required");
  if (actor.id === targetId) throw new HttpError(403, "forbidden", "Cannot change your own roles");
  return (db as Db).$transaction(async (tx) => {
    if (!(await tx.user.findUnique({ where: { id: targetId }, select: { id: true } }))) throw new HttpError(404, "not_found", "User not found");
    await tx.userRole.upsert({
      where: { userId_role: { userId: targetId, role } },
      create: { userId: targetId, role, grantedById: actor.id, reason },
      update: {},
    });
    await audit(tx, actor, "role.granted", targetId, { role, reason });
    return { userId: targetId, role };
  });
}

export async function revokeStaffRole(db: unknown, actor: Actor, targetId: string, role: Role) {
  if (actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Super admin access required");
  if (actor.id === targetId) throw new HttpError(403, "forbidden", "Cannot change your own roles");
  return (db as Db).$transaction(async (tx) => {
    if (role === "SUPER_ADMIN" && (await tx.userRole.count({ where: { role: "SUPER_ADMIN" } })) <= 2) {
      throw new HttpError(409, "conflict", "At least 2 SUPER_ADMINs must remain");
    }
    const r = await tx.userRole.deleteMany({ where: { userId: targetId, role } });
    if (r.count === 0) throw new HttpError(404, "not_found", "Role not assigned");
    await audit(tx, actor, "role.revoked", targetId, { role });
    return { userId: targetId, role };
  });
}
