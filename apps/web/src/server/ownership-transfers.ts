/**
 * Delayed two-party ownership changes (m3b-spec section 3, ADR-0020, SEL-006). ADD_OWNER / TRANSFER need the target's
 * acceptance (2FA + step-up); REMOVE_OWNER needs none but can be cancelled. Nothing changes before createdAt + 72 h, at least
 * one OWNER always remains, and every transition is audited. The seller id always comes from the path or the loaded row.
 */
import { assertAuditMetadataClean, hashEmailToken, type SellerMemberRole, systemClock } from "@rp/core";
import type { Prisma } from "@rp/db";
import type { Db } from "./db";
import { HttpError } from "./http";
import { requireSellerPermission } from "./sellers";
import type { Actor } from "./session";
import { assertFreshStepUp } from "./user-sessions";

type Tx = Prisma.TransactionClient;
export type TransferKind = "ADD_OWNER" | "TRANSFER" | "REMOVE_OWNER";
export type Outcome = "REMAIN_OWNER" | "BECOME_MANAGER" | "BECOME_RESPONDER" | "REMOVED";
export type EndReason =
  | "CANCELLED_BY_INITIATOR" | "CANCELLED_BY_OWNER" | "CANCELLED_BY_TARGET" | "CANCELLED_BY_LINK" | "CANCELLED_BY_STAFF" | "CANCELLED_MEMBERSHIP_CHANGED"
  | "INITIATOR_NOT_OWNER" | "TARGET_NOT_ELIGIBLE" | "TWO_FACTOR_MISSING" | "SELLER_BLOCKED" | "LAST_OWNER";

export const OWNERSHIP_CHANGE = {
  /** Floor of 72 h (also enforced by chk_transfer_delay). A configured value below the floor is ignored. */
  delayMs: 72 * 3_600_000,
  acceptWindowMs: 7 * 86_400_000,
  maxPerSellerPer7Days: 3,
  linkFailure: () => new HttpError(400, "invalid_or_expired", "This link is invalid or has expired"),
} as const;

const DAY_MS = 86_400_000;
const notFound = () => new HttpError(404, "not_found", "Not found");
const OPEN = ["PENDING", "ACCEPTED"] as const;
const lockSeller = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM sellers WHERE id = ${id} FOR UPDATE`;

function audit(tx: Tx, actor: { id: string | null; type: "USER" | "STAFF" | "SYSTEM" }, action: string, entityId: string, metadata: Prisma.InputJsonValue) {
  assertAuditMetadataClean(metadata);
  return tx.auditLog.create({ data: { actorType: actor.type, actorId: actor.id, action, entityType: "SellerOwnershipTransfer", entityId, metadata } });
}
const outbox = (tx: Tx, type: string, transferId: string, status: string) => tx.outboxEvent.create({ data: { type, aggregateId: transferId, payload: { transferId, status } } });

/** Pure: the member roles after applying a change, or the reason it must fail. The seller must keep >= 1 OWNER. */
export function planOwnershipChange(
  kind: TransferKind,
  roles: ReadonlyMap<string, SellerMemberRole>,
  initiatorId: string,
  targetId: string,
  initiatorOutcome: Outcome,
  targetOutcome: Outcome | null,
): { ok: true; roles: Map<string, SellerMemberRole | null> } | { ok: false; reason: EndReason } {
  if (roles.get(initiatorId) !== "OWNER") return { ok: false, reason: "INITIATOR_NOT_OWNER" };
  const next = new Map<string, SellerMemberRole | null>(roles);
  const after = (o: Outcome): SellerMemberRole | null => (o === "BECOME_MANAGER" ? "MANAGER" : o === "BECOME_RESPONDER" ? "RESPONDER" : o === "REMOVED" ? null : "OWNER");
  if (kind === "REMOVE_OWNER") {
    if (roles.get(targetId) !== "OWNER") return { ok: false, reason: "TARGET_NOT_ELIGIBLE" };
    next.set(targetId, after(targetOutcome ?? "REMOVED"));
  } else {
    const r = roles.get(targetId);
    if (r !== "MANAGER" && r !== "RESPONDER") return { ok: false, reason: "TARGET_NOT_ELIGIBLE" };
    next.set(targetId, "OWNER"); // B becomes OWNER BEFORE A steps down
    if (kind === "TRANSFER") next.set(initiatorId, after(initiatorOutcome));
  }
  if (![...next.values()].some((r) => r === "OWNER")) return { ok: false, reason: "LAST_OWNER" };
  return { ok: true, roles: next };
}

async function eligibleUser(tx: Tx, userId: string): Promise<"ok" | "inactive" | "no_2fa"> {
  const [u, tf] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { status: true, emailVerifiedAt: true } }),
    tx.twoFactorTotp.findUnique({ where: { userId }, select: { confirmedAt: true } }),
  ]);
  if (!u || u.status !== "ACTIVE" || !u.emailVerifiedAt) return "inactive";
  return tf?.confirmedAt ? "ok" : "no_2fa";
}

async function sellerBlocked(tx: Tx, sellerId: string, now: Date) {
  const [s, susp] = await Promise.all([
    tx.seller.findUnique({ where: { id: sellerId }, select: { status: true, closedAt: true } }),
    tx.enforcementAction.findFirst({ where: { subjectSellerId: sellerId, type: "SELLER_SUSPENSION", status: "ACTIVE", startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { id: true } }),
  ]);
  return !s || !!s.closedAt || s.status === "CLOSED" || s.status === "SUSPENDED" || !!susp;
}


export interface CreateTransferInput { kind: TransferKind; targetUserId: string; initiatorOutcome?: Outcome; targetOutcome?: Outcome }

/** T1. Needs the OWNER role, a 2FA-verified session (gate in authorizeSeller) and a fresh step-up. */
export async function createTransfer(db: Db, actor: Actor, sellerId: string, input: CreateTransferInput, now = systemClock.now()) {
  await requireSellerPermission(db, actor, "seller.member.manage", sellerId, now);
  assertFreshStepUp(actor.stepUpAt, now);
  if (input.targetUserId === actor.id) throw new HttpError(400, "validation_error", "Choose another member");
  const initiatorOutcome: Outcome = input.kind === "TRANSFER" ? input.initiatorOutcome ?? "BECOME_MANAGER" : "REMAIN_OWNER";
  const targetOutcome: Outcome | null = input.kind === "REMOVE_OWNER" ? input.targetOutcome ?? "REMOVED" : null;
  if (initiatorOutcome === "REMAIN_OWNER" && input.kind === "TRANSFER") throw new HttpError(400, "validation_error", "A transfer must change the initiator's role");
  if (targetOutcome === "REMAIN_OWNER") throw new HttpError(400, "validation_error", "Invalid outcome");

  return db.$transaction(async (tx) => {
    await lockSeller(tx, sellerId);
    if (await sellerBlocked(tx, sellerId, now)) throw new HttpError(403, "SELLER_SUSPENDED", "This seller cannot change ownership");
    const members = await tx.sellerMember.findMany({ where: { sellerId }, select: { userId: true, role: true } });
    const target = members.find((m) => m.userId === input.targetUserId);
    if (!target) throw new HttpError(409, "target_not_member", "The target must be a member of this seller");
    if (input.kind === "REMOVE_OWNER") {
      if (target.role !== "OWNER") throw new HttpError(409, "target_not_owner", "The target is not an owner");
    } else {
      if (target.role === "OWNER") throw new HttpError(409, "target_already_owner", "The target is already an owner");
      const el = await eligibleUser(tx, input.targetUserId);
      if (el === "inactive") throw new HttpError(409, "target_not_eligible", "The target account is not eligible");
      if (el === "no_2fa") throw new HttpError(409, "target_two_factor_required", "The target must enable two-factor authentication first");
    }
    if (await tx.sellerOwnershipTransfer.findFirst({ where: { sellerId, status: { in: [...OPEN] } }, select: { id: true } })) {
      throw new HttpError(409, "ownership_change_pending", "An ownership change is already in progress");
    }
    if ((await tx.sellerOwnershipTransfer.count({ where: { sellerId, createdAt: { gt: new Date(now.getTime() - 7 * DAY_MS) } } })) >= OWNERSHIP_CHANGE.maxPerSellerPer7Days) {
      throw new HttpError(429, "rate_limited", "Too many ownership changes", { "Retry-After": "3600" });
    }
    const remove = input.kind === "REMOVE_OWNER";
    const row = await tx.sellerOwnershipTransfer.create({
      data: {
        sellerId, kind: input.kind, status: remove ? "ACCEPTED" : "PENDING", initiatorId: actor.id, targetUserId: input.targetUserId, initiatorOutcome, targetOutcome,
        openKey: sellerId, executeAfter: new Date(now.getTime() + OWNERSHIP_CHANGE.delayMs), acceptBy: new Date(now.getTime() + OWNERSHIP_CHANGE.acceptWindowMs),
        acceptedAt: remove ? now : null,
      },
      select: { id: true, status: true, executeAfter: true, acceptBy: true },
    });
    // One cancel-token row per OWNER and for the target; the worker mints and mails the raw token (only its hash is stored).
    const recipients = new Set([...members.filter((m) => m.role === "OWNER").map((m) => m.userId), input.targetUserId]);
    for (const recipientId of recipients) await tx.sellerTransferCancelToken.create({ data: { transferId: row.id, recipientId } });
    await outbox(tx, "seller.ownership_transfer_requested", row.id, row.status);
    await audit(tx, { id: actor.id, type: "USER" }, "seller.ownership_transfer.requested", row.id, {
      sellerId, kind: input.kind, initiatorId: actor.id, targetUserId: input.targetUserId, initiatorOutcome, targetOutcome,
    });
    return { id: row.id, status: row.status, executeAfter: row.executeAfter, acceptBy: row.acceptBy };
  });
}

type TransferRow = { id: string; sellerId: string; kind: TransferKind; status: string; initiatorId: string; targetUserId: string; initiatorOutcome: Outcome; targetOutcome: Outcome | null; executeAfter: Date; acceptBy: Date };
const TRANSFER_SELECT = { id: true, sellerId: true, kind: true, status: true, initiatorId: true, targetUserId: true, initiatorOutcome: true, targetOutcome: true, executeAfter: true, acceptBy: true } as const;

async function end(tx: Tx, t: TransferRow, status: "COMPLETED" | "CANCELLED" | "EXPIRED" | "FAILED", now: Date, extra: { endReason?: EndReason; endedById?: string | null }, actor: { id: string | null; type: "USER" | "STAFF" | "SYSTEM" }) {
  await tx.sellerOwnershipTransfer.update({ where: { id: t.id }, data: { status, endedAt: now, openKey: null, endReason: extra.endReason ?? null, endedById: extra.endedById ?? null } });
  await outbox(tx, `seller.ownership_transfer_${status.toLowerCase()}`, t.id, status);
  await audit(tx, actor, `seller.ownership_transfer.${status.toLowerCase()}`, t.id, { sellerId: t.sellerId, kind: t.kind, initiatorId: t.initiatorId, targetUserId: t.targetUserId, endReason: extra.endReason ?? null });
}

/** T4/T5, run under the seller lock as the SYSTEM principal applying an earlier, authorized decision. Re-checks everything. */
async function executeLocked(tx: Tx, t: TransferRow, now: Date): Promise<{ ok: true } | { ok: false; reason: EndReason }> {
  const system = { id: null, type: "SYSTEM" as const };
  const fail = async (reason: EndReason) => { await end(tx, t, "FAILED", now, { endReason: reason }, system); return { ok: false as const, reason }; };
  if (now < t.executeAfter) throw new HttpError(409, "invalid_transition", "Too early to execute");
  if (await sellerBlocked(tx, t.sellerId, now)) return fail("SELLER_BLOCKED");
  const members = await tx.sellerMember.findMany({ where: { sellerId: t.sellerId }, select: { userId: true, role: true } });
  const roles = new Map(members.map((m) => [m.userId, m.role as SellerMemberRole]));
  if ((await eligibleUser(tx, t.initiatorId)) !== "ok") return fail(roles.get(t.initiatorId) === "OWNER" && (await eligibleUser(tx, t.initiatorId)) === "no_2fa" ? "TWO_FACTOR_MISSING" : "INITIATOR_NOT_OWNER");
  if (t.kind !== "REMOVE_OWNER") {
    const el = await eligibleUser(tx, t.targetUserId);
    if (el !== "ok") return fail(el === "no_2fa" ? "TWO_FACTOR_MISSING" : "TARGET_NOT_ELIGIBLE");
  }
  const plan = planOwnershipChange(t.kind, roles, t.initiatorId, t.targetUserId, t.initiatorOutcome, t.targetOutcome);
  if (!plan.ok) return fail(plan.reason);
  // Promotions first (B becomes OWNER before A steps down), then demotions/removals.
  const changes = [...plan.roles.entries()].filter(([u, r]) => roles.get(u) !== r).sort(([, a], [, b]) => Number(b === "OWNER") - Number(a === "OWNER"));
  for (const [userId, role] of changes) {
    if (role === null) await tx.sellerMember.delete({ where: { sellerId_userId: { sellerId: t.sellerId, userId } } });
    else await tx.sellerMember.update({ where: { sellerId_userId: { sellerId: t.sellerId, userId } }, data: { role } });
    await audit(tx, system, "seller.member.role_changed", t.id, { sellerId: t.sellerId, userId, from: roles.get(userId) ?? null, to: role });
  }
  await end(tx, t, "COMPLETED", now, {}, system);
  return { ok: true };
}

/** T2/T3/T3': the target accepts. Needs a 2FA-verified session and a fresh step-up. Before executeAfter this only records acceptance. */
export async function acceptTransfer(db: Db, actor: Actor, transferId: string, now = systemClock.now()) {
  if (!actor.twoFactor?.enrolled || !actor.twoFactor.verified) throw new HttpError(403, "TWO_FACTOR_REQUIRED", "Two-factor authentication required");
  assertFreshStepUp(actor.stepUpAt, now);
  const pre = await db.sellerOwnershipTransfer.findUnique({ where: { id: transferId }, select: { sellerId: true, targetUserId: true } });
  if (!pre || pre.targetUserId !== actor.id) throw notFound(); // not the target: no existence leak
  const result = await db.$transaction(async (tx) => {
    await lockSeller(tx, pre.sellerId);
    const t = (await tx.sellerOwnershipTransfer.findUnique({ where: { id: transferId }, select: TRANSFER_SELECT })) as TransferRow | null;
    if (!t || t.targetUserId !== actor.id) throw notFound();
    if (t.status !== "PENDING" || t.kind === "REMOVE_OWNER") throw new HttpError(409, "invalid_transition", "That action is not allowed in the current state");
    if (now >= t.acceptBy) throw new HttpError(409, "invalid_transition", "This request has expired");
    if ((await eligibleUser(tx, actor.id)) !== "ok") throw new HttpError(403, "TWO_FACTOR_REQUIRED", "Two-factor authentication required");
    await tx.sellerOwnershipTransfer.update({ where: { id: t.id }, data: { status: "ACCEPTED", acceptedAt: now } });
    await outbox(tx, "seller.ownership_transfer_accepted", t.id, "ACCEPTED");
    await audit(tx, { id: actor.id, type: "USER" }, "seller.ownership_transfer.accepted", t.id, { sellerId: t.sellerId, kind: t.kind, targetUserId: t.targetUserId });
    if (now < t.executeAfter) return { status: "ACCEPTED" as const };
    const r = await executeLocked(tx, { ...t, status: "ACCEPTED" }, now);
    return r.ok ? { status: "COMPLETED" as const } : { status: "FAILED" as const, reason: r.reason };
  });
  if (result.status === "FAILED") throw new HttpError(409, result.reason, "The ownership change could not be completed");
  return { id: transferId, status: result.status };
}

/** Job/sweeper T4/T5 (`maintenance.ownership-transfer-execute`): idempotent, a non-ACCEPTED or not-yet-due transfer is a no-op. */
export async function executeTransfer(db: Db, transferId: string, now = systemClock.now()) {
  const pre = await db.sellerOwnershipTransfer.findUnique({ where: { id: transferId }, select: { sellerId: true } });
  if (!pre) return { status: "MISSING" as const };
  return db.$transaction(async (tx) => {
    await lockSeller(tx, pre.sellerId);
    const t = (await tx.sellerOwnershipTransfer.findUnique({ where: { id: transferId }, select: TRANSFER_SELECT })) as TransferRow | null;
    if (!t || t.status !== "ACCEPTED" || now < t.executeAfter) return { status: t?.status ?? ("MISSING" as const) };
    const r = await executeLocked(tx, t, now);
    return r.ok ? { status: "COMPLETED" as const } : { status: "FAILED" as const, reason: r.reason };
  });
}

/** T7 sweeper: PENDING transfers whose acceptBy passed become EXPIRED. */
export async function expireTransfers(db: Db, now = systemClock.now()) {
  const due = await db.sellerOwnershipTransfer.findMany({ where: { status: "PENDING", acceptBy: { lte: now } }, select: { id: true, sellerId: true }, take: 100 });
  let n = 0;
  for (const d of due) {
    await db.$transaction(async (tx) => {
      await lockSeller(tx, d.sellerId);
      const t = (await tx.sellerOwnershipTransfer.findUnique({ where: { id: d.id }, select: TRANSFER_SELECT })) as TransferRow | null;
      if (!t || t.status !== "PENDING" || now < t.acceptBy) return;
      await end(tx, t, "EXPIRED", now, {}, { id: null, type: "SYSTEM" });
      n++;
    });
  }
  return { expired: n };
}

/** T6 (in app): the initiator, any OWNER of the seller or the target. Protective: no 2FA gate and no step-up (ADR-0020). */
export async function cancelTransfer(db: Db, actor: Actor, transferId: string, now = systemClock.now()) {
  const pre = await db.sellerOwnershipTransfer.findUnique({ where: { id: transferId }, select: { sellerId: true } });
  if (!pre) throw notFound();
  return db.$transaction(async (tx) => {
    await lockSeller(tx, pre.sellerId);
    const [t, user, member] = await Promise.all([
      tx.sellerOwnershipTransfer.findUnique({ where: { id: transferId }, select: TRANSFER_SELECT }) as Promise<TransferRow | null>,
      tx.user.findUnique({ where: { id: actor.id }, select: { status: true } }),
      tx.sellerMember.findUnique({ where: { sellerId_userId: { sellerId: pre.sellerId, userId: actor.id } }, select: { role: true } }),
    ]);
    if (!t || user?.status !== "ACTIVE") throw notFound();
    const reason: EndReason | null = t.initiatorId === actor.id ? "CANCELLED_BY_INITIATOR" : t.targetUserId === actor.id ? "CANCELLED_BY_TARGET" : member?.role === "OWNER" ? "CANCELLED_BY_OWNER" : null;
    if (!reason) throw notFound(); // not a party and not an OWNER: 404, no leak
    if (t.status !== "PENDING" && t.status !== "ACCEPTED") throw new HttpError(409, "invalid_transition", "That action is not allowed in the current state");
    await end(tx, t, "CANCELLED", now, { endReason: reason, endedById: actor.id }, { id: actor.id, type: "USER" });
    return { id: t.id, status: "CANCELLED" as const };
  });
}

/** T6 (staff): an ADMIN who is not a member of the seller; reason code required. */
export async function staffCancelTransfer(db: Db, actor: Actor, transferId: string, reasonCode: string, now = systemClock.now()) {
  if (actor.role !== "admin" && actor.role !== "super_admin") throw new HttpError(403, "forbidden", "Admin access required");
  if (!/^[A-Z0-9_]{2,40}$/.test(reasonCode)) throw new HttpError(400, "validation_error", "reasonCode is required");
  const pre = await db.sellerOwnershipTransfer.findUnique({ where: { id: transferId }, select: { sellerId: true } });
  if (!pre) throw notFound();
  return db.$transaction(async (tx) => {
    await lockSeller(tx, pre.sellerId);
    if (await tx.sellerMember.findUnique({ where: { sellerId_userId: { sellerId: pre.sellerId, userId: actor.id } }, select: { userId: true } })) {
      throw new HttpError(403, "CONFLICT_OF_INTEREST", "You are a member of this seller");
    }
    const t = (await tx.sellerOwnershipTransfer.findUnique({ where: { id: transferId }, select: TRANSFER_SELECT })) as TransferRow | null;
    if (!t) throw notFound();
    if (t.status !== "PENDING" && t.status !== "ACCEPTED") throw new HttpError(409, "invalid_transition", "That action is not allowed in the current state");
    await end(tx, t, "CANCELLED", now, { endReason: "CANCELLED_BY_STAFF", endedById: actor.id }, { id: actor.id, type: "STAFF" });
    return { id: t.id, status: "CANCELLED" as const };
  });
}

/** T6 (link): no sign-in. One conditional update burns the token; every failure is the same 400. */
export async function cancelByLink(db: Db, rawToken: string, now = systemClock.now()) {
  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 128) throw OWNERSHIP_CHANGE.linkFailure();
  const tok = await db.sellerTransferCancelToken.findUnique({ where: { tokenHash: hashEmailToken(rawToken) }, select: { id: true, transferId: true, usedAt: true } });
  if (!tok) throw OWNERSHIP_CHANGE.linkFailure();
  const pre = await db.sellerOwnershipTransfer.findUnique({ where: { id: tok.transferId }, select: { sellerId: true } });
  if (!pre) throw OWNERSHIP_CHANGE.linkFailure();
  return db.$transaction(async (tx) => {
    await lockSeller(tx, pre.sellerId);
    const t = (await tx.sellerOwnershipTransfer.findUnique({ where: { id: tok.transferId }, select: TRANSFER_SELECT })) as TransferRow | null;
    if (!t || (t.status !== "PENDING" && t.status !== "ACCEPTED")) throw OWNERSHIP_CHANGE.linkFailure();
    const burned = await tx.sellerTransferCancelToken.updateMany({ where: { id: tok.id, usedAt: null }, data: { usedAt: now } });
    if (burned.count !== 1) throw OWNERSHIP_CHANGE.linkFailure();
    await end(tx, t, "CANCELLED", now, { endReason: "CANCELLED_BY_LINK" }, { id: null, type: "SYSTEM" });
    return { status: "CANCELLED" as const };
  });
}

/** GET list for the seller's OWNERs (open + the last 20 ended) or the target. */
export async function listTransfers(db: Db, actor: Actor, sellerId: string, now = systemClock.now()) {
  await requireSellerPermission(db, actor, "seller.member.manage", sellerId, now);
  const [open, ended] = await Promise.all([
    db.sellerOwnershipTransfer.findMany({ where: { sellerId, status: { in: [...OPEN] } }, orderBy: { createdAt: "desc" }, select: { ...TRANSFER_SELECT, acceptedAt: true, createdAt: true } }),
    db.sellerOwnershipTransfer.findMany({ where: { sellerId, status: { in: ["COMPLETED", "CANCELLED", "EXPIRED", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 20, select: { ...TRANSFER_SELECT, endedAt: true, endReason: true } }),
  ]);
  return { open, ended };
}
