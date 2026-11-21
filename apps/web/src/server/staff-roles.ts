import { assertAuditMetadataClean } from "@rp/core";
import type { Prisma } from "@rp/db";
import { HttpError } from "./http";
import type { Actor } from "./session";

type Role = "MODERATOR" | "SENIOR_MODERATOR" | "ADMIN" | "SUPER_ADMIN";

interface Db {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
interface Tx {
  user: { findUnique(a: unknown): Promise<{ id: string; status?: string; emailVerifiedAt?: Date | null } | null> };
  twoFactorTotp: { findUnique(a: unknown): Promise<{ confirmedAt: Date | null } | null> };
  userSession: { updateMany(a: unknown): Promise<unknown> };
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

const revokeTargetSessions = (tx: Tx, userId: string) =>
  tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "role_changed" } });

/** Caller must already have passed requireSuperAdmin(); this re-checks defensively and applies the guards from ADR-0003. */
export async function grantStaffRole(db: unknown, actor: Actor, targetId: string, role: Role, reason: string) {
  if (actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Super admin access required");
  if (actor.id === targetId) throw new HttpError(403, "forbidden", "Cannot change your own roles");
  return (db as Db).$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, status: true, emailVerifiedAt: true } });
    if (!target) throw new HttpError(404, "not_found", "User not found");
    // T-06: only an ACTIVE, email-verified account with confirmed 2FA can receive a staff role.
    if (target.status !== "ACTIVE" || !target.emailVerifiedAt) throw new HttpError(409, "target_not_eligible", "Target must be an active, verified account");
    if (!(await tx.twoFactorTotp.findUnique({ where: { userId: targetId }, select: { confirmedAt: true } }))?.confirmedAt) {
      throw new HttpError(409, "target_two_factor_missing", "Target must have two-factor authentication enabled");
    }
    await tx.userRole.upsert({
      where: { userId_role: { userId: targetId, role } },
      create: { userId: targetId, role, grantedById: actor.id, reason },
      update: {},
    });
    await revokeTargetSessions(tx, targetId); // the next sign-in gets the staff lifetimes (ADR-0002)
    await audit(tx, actor, "role.granted", targetId, { role, reason });
    return { userId: targetId, role };
  });
}

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
