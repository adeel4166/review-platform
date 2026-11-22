import { createHash } from "node:crypto";
import { ApprovalError, assertCanApprove, approvalExpiry, assertAuditMetadataClean, canonicalJson, roleGrantNeedsFourEyes, targetKeyFor, validateModerationConfig, type ApprovalKind, type Clock, type StaffRole } from "@rp/core";
import { HttpError } from "./http";

/** Four-eyes service (ADR-0026, spec §8). Written against a structural Prisma-shaped client, like staff-roles.ts. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Model = { findUnique(a: any): Promise<any>; findFirst(a: any): Promise<any>; create(a: any): Promise<any>; updateMany(a: any): Promise<{ count: number }>; upsert(a: any): Promise<any>; deleteMany(a: any): Promise<{ count: number }>; findMany(a: any): Promise<any[]>; count(a: any): Promise<number> };
export interface ApprovalDb { $transaction<T>(fn: (tx: ApprovalTx) => Promise<T>): Promise<T> }
export interface ApprovalTx { staffApprovalRequest: Model; moderationConfig: Model; userRole: Model; userSession: Model; twoFactorTotp: Model; twoFactorRecoveryCode?: Model; auditLog: Model; outboxEvent: Model; user: Model }
export interface Staff { id: string; roles: readonly StaffRole[]; stepUpAt?: number | null }
type Json = Record<string, string | number | boolean | null>;

export const hashPayload = (p: unknown): string => createHash("sha256").update(canonicalJson(p)).digest("hex");
const audit = (tx: ApprovalTx, actor: string, action: string, entityType: string, entityId: string, metadata: Json) => {
  assertAuditMetadataClean(metadata);
  return tx.auditLog.create({ data: { actorType: "STAFF", actorId: actor, action, entityType, entityId, metadata } });
};
const requireStepUp = (a: Staff, clock: Clock) => {
  if (a.stepUpAt == null || clock.now().getTime() - a.stepUpAt > 600_000) throw new HttpError(401, "STEP_UP_REQUIRED", "Re-authentication required");
};

async function createRequest(tx: ApprovalTx, clock: Clock, kind: ApprovalKind, requestedById: string, targetKey: string, payload: Json) {
  if (await tx.staffApprovalRequest.findFirst({ where: { openKey: targetKey, status: "PENDING" } })) throw new HttpError(409, "approval_pending", "A request for this target is already pending");
  const r = await tx.staffApprovalRequest.create({ data: { kind, status: "PENDING", requestedById, targetKey, openKey: targetKey, payload, payloadHash: hashPayload(payload), expiresAt: approvalExpiry(clock), createdAt: clock.now() } });
  await audit(tx, requestedById, "approval.requested", "StaffApprovalRequest", r.id, { kind });
  await tx.outboxEvent.create({ data: { type: "approval.requested", aggregateId: r.id, payload: { approvalRequestId: r.id, kind } } });
  return r as { id: string };
}

/** `POST /api/admin/config/moderation/:version/activation-requests` (ADMIN+, step-up). Validates the draft first (CFG-001/002/005). */
export async function requestConfigActivation(db: ApprovalDb, actor: Staff, version: string, clock: Clock) {
  requireStepUp(actor, clock);
  if (!actor.roles.some((r) => r === "ADMIN" || r === "SUPER_ADMIN")) throw new HttpError(403, "forbidden", "config.manage required");
  return db.$transaction(async (tx) => {
    const cfg = await tx.moderationConfig.findUnique({ where: { version } });
    if (!cfg) throw new HttpError(404, "not_found", "Config version not found");
    if (cfg.status === "ACTIVE" || cfg.status === "RETIRED") throw new HttpError(409, "conflict", "Version is not a draft");
    try { validateModerationConfig(cfg.config); } catch (e) { throw new HttpError(422, (e as { code?: string }).code ?? "config_invalid", "Config failed validation"); }
    const req = await createRequest(tx, clock, "CONFIG_ACTIVATION", actor.id, targetKeyFor.config(version), { version, checksum: cfg.checksum });
    return { approvalRequestId: req.id };
  });
}

/** Role grants: MODERATOR is single-actor (SUPER_ADMIN or ADMIN, step-up); the other roles create a request (`202`). */
export async function requestRoleGrant(db: ApprovalDb, actor: Staff, targetId: string, role: StaffRole, reason: string, clock: Clock): Promise<{ status: 202; approvalRequestId: string } | { status: 201; granted: true }> {
  requireStepUp(actor, clock);
  const isSuper = actor.roles.includes("SUPER_ADMIN");
  if (actor.id === targetId) throw new HttpError(403, "forbidden", "Cannot change your own roles");
  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, status: true, emailVerifiedAt: true } });
    if (!target) throw new HttpError(404, "not_found", "User not found");
    if (target.status !== "ACTIVE" || !target.emailVerifiedAt) throw new HttpError(409, "target_not_eligible", "Target must be an active, verified account");
    if (!(await tx.twoFactorTotp.findUnique({ where: { userId: targetId } }))?.confirmedAt) throw new HttpError(409, "target_two_factor_missing", "Target must have two-factor authentication enabled");
    if (!roleGrantNeedsFourEyes(role)) {
      if (!isSuper && !actor.roles.includes("ADMIN")) throw new HttpError(403, "forbidden", "Not allowed");
      await grant(tx, targetId, role, actor.id, reason, clock);
      await audit(tx, actor.id, "role.granted", "User", targetId, { role });
      return { status: 201 as const, granted: true as const };
    }
    if (!isSuper) throw new HttpError(403, "forbidden", "Super admin access required"); // AZ-015
    const req = await createRequest(tx, clock, "ROLE_GRANT", actor.id, targetKeyFor.role(targetId, role), { userId: targetId, role, reason: reason.slice(0, 200) });
    return { status: 202 as const, approvalRequestId: req.id };
  });
}
export async function requestTwoFactorReset(db: ApprovalDb, actor: Staff, targetId: string, clock: Clock) {
  requireStepUp(actor, clock);
  if (!actor.roles.some((r) => r === "ADMIN" || r === "SUPER_ADMIN")) throw new HttpError(403, "forbidden", "user.manage required");
  return db.$transaction(async (tx) => ({ approvalRequestId: (await createRequest(tx, clock, "TWO_FACTOR_RESET", actor.id, targetKeyFor.twoFa(targetId), { userId: targetId })).id }));
}
/** Used by A4/A5 on BAN / SELLER_SUSPENSION (AP-1) and by break-glass repeat access. */
export async function requestApproval(tx: ApprovalTx, clock: Clock, kind: "ENFORCEMENT_OVERTURN_MAJOR" | "BREAK_GLASS_REPEAT", requestedById: string, targetKey: string, payload: Json) {
  return (await createRequest(tx, clock, kind, requestedById, targetKey, payload)).id;
}

async function grant(tx: ApprovalTx, userId: string, role: string, grantedById: string, reason: string, clock: Clock) {
  await tx.userRole.upsert({ where: { userId_role: { userId, role } }, create: { userId, role, grantedById, reason }, update: {} });
  await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: clock.now(), revokeReason: "role_changed" } });
}

/** Approve and execute in one transaction. The conditional `updateMany(status = PENDING)` makes a double-approve a 409. */
export async function approveRequest(db: ApprovalDb, approver: Staff, id: string, clock: Clock) {
  requireStepUp(approver, clock);
  return db.$transaction(async (tx) => {
    const a = await tx.staffApprovalRequest.findUnique({ where: { id } });
    if (!a) throw new HttpError(404, "not_found", "Approval request not found");
    let currentHash = a.payloadHash;
    if (a.kind === "CONFIG_ACTIVATION") {
      const cfg = await tx.moderationConfig.findUnique({ where: { version: a.payload.version } });
      currentHash = cfg && cfg.status !== "ACTIVE" && cfg.checksum === a.payload.checksum ? a.payloadHash : "stale";
    }
    try { assertCanApprove({ kind: a.kind, status: a.status, requestedById: a.requestedById, expiresAt: a.expiresAt, payloadHash: a.payloadHash }, approver, clock, currentHash); }
    catch (e) { if (e instanceof ApprovalError) throw new HttpError(e.status, e.code, e.code); throw e; }
    const won = await tx.staffApprovalRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "EXECUTED", decidedById: approver.id, decidedAt: clock.now(), executedAt: clock.now(), openKey: null } });
    if (won.count !== 1) throw new HttpError(409, "not_pending", "Already decided");
    const p = a.payload as Record<string, string>;
    if (a.kind === "CONFIG_ACTIVATION") {
      const prev = await tx.moderationConfig.findFirst({ where: { status: "ACTIVE" } });
      if (prev) await tx.moderationConfig.updateMany({ where: { id: prev.id, status: "ACTIVE" }, data: { status: "RETIRED", retiredAt: clock.now() } });
      await tx.moderationConfig.updateMany({ where: { version: p.version }, data: { status: "ACTIVE", activatedById: a.requestedById, approvedById: approver.id, activatedAt: clock.now() } });
      await audit(tx, approver.id, "config.activate", "ModerationConfig", p.version!, { version: p.version!, previousVersion: prev?.version ?? null, requestedById: a.requestedById }); // earlier decisions keep their configVersion (CFG-003)
    } else if (a.kind === "ROLE_GRANT") {
      await grant(tx, p.userId!, p.role!, a.requestedById, p.reason ?? "", clock);
      await audit(tx, approver.id, "role.granted", "User", p.userId!, { role: p.role!, requestedById: a.requestedById });
    } else if (a.kind === "TWO_FACTOR_RESET") {
      await tx.twoFactorTotp.deleteMany({ where: { userId: p.userId } });
      await tx.twoFactorRecoveryCode?.deleteMany({ where: { userId: p.userId } });
      await tx.userSession.updateMany({ where: { userId: p.userId, revokedAt: null }, data: { revokedAt: clock.now(), revokeReason: "two_factor_reset" } });
      await tx.outboxEvent.create({ data: { type: "auth.security_alert", aggregateId: p.userId!, payload: { userId: p.userId, kind: "two_factor_reset" } } });
      await audit(tx, approver.id, "user.2fa_reset", "User", p.userId!, { requestedById: a.requestedById });
    } else await audit(tx, approver.id, "approval.executed", "StaffApprovalRequest", id, { kind: a.kind });
    await tx.outboxEvent.create({ data: { type: "approval.executed", aggregateId: id, payload: { approvalRequestId: id, kind: a.kind } } });
    return { id, kind: a.kind as ApprovalKind, status: "EXECUTED" as const };
  });
}
export async function rejectOrCancel(db: ApprovalDb, actor: Staff, id: string, mode: "reject" | "cancel", note: string | undefined, clock: Clock) {
  return db.$transaction(async (tx) => {
    const a = await tx.staffApprovalRequest.findUnique({ where: { id } });
    if (!a) throw new HttpError(404, "not_found", "Approval request not found");
    if (mode === "cancel" && a.requestedById !== actor.id) throw new HttpError(403, "forbidden", "Only the requester can cancel");
    if (mode === "reject" && a.requestedById === actor.id) throw new HttpError(403, "approval_self", "approval_self");
    const r = await tx.staffApprovalRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: mode === "reject" ? "REJECTED" : "CANCELLED", decidedById: mode === "reject" ? actor.id : null, decidedAt: clock.now(), openKey: null, note: note?.slice(0, 500) } });
    if (r.count !== 1) throw new HttpError(409, "not_pending", "Already decided");
    await audit(tx, actor.id, `approval.${mode === "reject" ? "rejected" : "cancelled"}`, "StaffApprovalRequest", id, { kind: a.kind });
    return { id, status: mode === "reject" ? "REJECTED" : "CANCELLED" };
  });
}
