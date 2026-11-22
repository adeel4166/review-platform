import { BREAK_GLASS_HEADERS, BreakGlassError, assertAccessUsable, decideBreakGlass, type Clock } from "@rp/core";
import { HttpError } from "./http";
import { requestApproval, type ApprovalTx, type Staff } from "./approvals";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Break-glass `proof.view_original` (ADR-0027). The ONLY module that may read `proof/<id>/orig/*` keys (static test: break-glass.test.ts). */
export interface BreakGlassTx extends ApprovalTx { breakGlassAccess: any; purchaseProof: any; purchaseProofFile: any }
export interface BreakGlassDb { $transaction<T>(fn: (tx: BreakGlassTx) => Promise<T>): Promise<T> }
export interface BreakGlassStore { getObject(key: string): Promise<{ body: ReadableStream | Uint8Array; contentType: string }> }
const day = 24 * 3_600_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** SEC-M6-03: the key is built only from a DB-verified file id, never from request strings (worker writes originals at `proof/<fileId>/orig`). */
const originalKeyOf = (fileId: string) => { if (!SAFE_ID.test(fileId)) throw new HttpError(404, "not_found", "Not found"); return `proof/${fileId}/orig`; };
/** The file must belong to the proof and be the unredacted original; a missing row is a 404, never a fallback record. */
async function loadOriginal(tx: BreakGlassTx, proofId: string, fileId: string) {
  const f = await tx.purchaseProofFile.findUnique({ where: { id: fileId }, select: { id: true, proofId: true, isRedacted: true, purgedAt: true } });
  if (!f || f.proofId !== proofId || f.isRedacted) throw new HttpError(404, "not_found", "File not found");
  return f as { id: string; purgedAt: Date | null };
}

export async function requestOriginalAccess(db: BreakGlassDb, staff: Staff & { sessionId: string }, i: { proofId: string; fileId: string; reasonCode: string; reasonText: string }, clock: Clock, alert: (k: string, d: Record<string, unknown>) => void) {
  if (!staff.sessionId) throw new HttpError(401, "unauthenticated", "Sign in required"); // SEC-M6-08: an empty session id would match itself
  return db.$transaction(async (tx) => {
    const proof = await tx.purchaseProof.findUnique({ where: { id: i.proofId }, select: { id: true, submittedById: true } });
    if (!proof) throw new HttpError(404, "not_found", "Proof not found");
    const file = await loadOriginal(tx, i.proofId, i.fileId);
    const now = clock.now();
    const accessesToday = await tx.breakGlassAccess.count({ where: { staffId: staff.id, createdAt: { gte: new Date(now.getTime() - day) } } });
    const recentSameSubmitter = await tx.breakGlassAccess.count({ where: { submitterId: proof.submittedById, createdAt: { gte: new Date(now.getTime() - 7 * day) } } });
    let d;
    try {
      d = decideBreakGlass({ clock, reasonText: i.reasonText, stepUpAt: staff.stepUpAt ?? null, originalExists: !file.purgedAt, staffId: staff.id, submitterId: proof.submittedById, accessesToday, recentSameSubmitter });
    } catch (e) {
      if (e instanceof BreakGlassError) { if (e.code === "break_glass_cap") alert("break_glass_cap", { staffId: staff.id }); throw new HttpError(e.status, e.code, e.code); }
      throw e;
    }
    if (d.kind === "needs_approval") {
      const id = await requestApproval(tx, clock, "BREAK_GLASS_REPEAT", staff.id, `bg:${proof.submittedById}`, { proofId: i.proofId, fileId: i.fileId, reasonCode: i.reasonCode });
      return { status: 202 as const, approvalRequestId: id };
    }
    const a = await tx.breakGlassAccess.create({ data: { staffId: staff.id, sessionId: staff.sessionId, proofId: i.proofId, fileId: i.fileId, submitterId: proof.submittedById, reasonCode: i.reasonCode, reasonText: i.reasonText.trim(), expiresAt: d.expiresAt, createdAt: now } });
    await tx.auditLog.create({ data: { actorType: "STAFF", actorId: staff.id, action: "proof.view_original", entityType: "PurchaseProof", entityId: i.proofId, metadata: { accessId: a.id, fileId: i.fileId, reasonCode: i.reasonCode } } });
    if (d.alert) alert("break_glass_daily_alert", { staffId: staff.id });
    return { status: 201 as const, accessId: a.id as string, expiresAt: d.expiresAt };
  });
}

/** Single use by conditional update (usedAt IS NULL), session bound, 60 s. Returns the bytes + the hardened headers. */
export async function serveOriginal(db: BreakGlassDb, store: BreakGlassStore, who: { staffId: string; sessionId: string }, accessId: string, clock: Clock) {
  const { access, key } = await db.$transaction(async (tx) => {
    const a = await tx.breakGlassAccess.findUnique({ where: { id: accessId } });
    if (!a) throw new HttpError(404, "not_found", "Not found");
    try { assertAccessUsable(a, who, clock); } catch (e) { if (e instanceof BreakGlassError) throw new HttpError(e.status, e.code, e.code); throw e; }
    const claimed = await tx.breakGlassAccess.updateMany({ where: { id: accessId, usedAt: null }, data: { usedAt: clock.now() } });
    if (claimed.count !== 1) throw new HttpError(409, "access_used", "access_used");
    await tx.auditLog.create({ data: { actorType: "STAFF", actorId: who.staffId, action: "proof.view_original.served", entityType: "PurchaseProof", entityId: a.proofId, metadata: { accessId, fileId: a.fileId } } });
    const f = await loadOriginal(tx, a.proofId, a.fileId);
    if (f.purgedAt) throw new HttpError(410, "original_purged", "original_purged");
    return { access: a, key: originalKeyOf(f.id) };
  });
  void access;
  const obj = await store.getObject(key); // server-side read; the key is never presigned or returned
  return { body: obj.body, headers: { ...BREAK_GLASS_HEADERS, "Content-Type": obj.contentType } as Record<string, string> };
}
