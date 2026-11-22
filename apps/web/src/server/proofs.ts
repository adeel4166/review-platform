import type { z } from "zod";
import {
  FRAUD_REASONS, assertNoAutoVerify, MEDIA_GET_TTL_SECONDS, MEDIA_MAX_BYTES, MEDIA_PUT_TTL_SECONDS, PROOF_CONSENT_VERSION, PROOF_MAX_FILES, PROOF_SLA_HOURS,
  hashOrderRef, orderRefCandidates, parseOrderRefKeys, proofEligibility, proofRetention, type ProofOriginalRetention,
} from "@rp/core";
import type { Db } from "./db";
import { HttpError } from "./http";
import type { Storage } from "./media";
import type { Actor } from "./session";
import type { labelRevokeInput, proofCreateInput, proofDecisionInput, proofFileInput } from "./validation";

assertNoAutoVerify(); // ADR-0008: PROOF_AUTO_VERIFY=true refuses to start (web and worker)
const notFound = () => new HttpError(404, "not_found", "Not found");
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
const ALLOWED_MIME: Record<string, "IMAGE" | "DOCUMENT"> = { "image/jpeg": "IMAGE", "image/png": "IMAGE", "image/webp": "IMAGE", "application/pdf": "DOCUMENT" };
export const proofFileKey = (fileId: string) => `in/proof/${fileId}`;
const staff = (a: Actor) => { if (a.role !== "admin" && a.role !== "super_admin") throw new HttpError(403, "FORBIDDEN_ROLE", "Admin access required"); };

export interface ProofCtx { charge?: () => Promise<void>; now?: Date; env?: Record<string, string | undefined> }

// ---------------------------------------------------------------------------------------------------------------------
// Author API (m4-m5-spec 5.7)
// ---------------------------------------------------------------------------------------------------------------------

export async function createProof(db: Db, userId: string, reviewId: string, input: z.infer<typeof proofCreateInput>, ctx: ProofCtx = {}) {
  const now = ctx.now ?? new Date();
  const review = await db.review.findFirst({ where: { id: reviewId, authorId: userId }, select: { id: true, status: true, verifiedProofId: true } });
  if (!review) throw notFound(); // other users' reviews are indistinguishable from missing ones (AZ-023, deny reason NOT_OWNER internal)
  const [revoked, open, rejected] = await Promise.all([
    db.enforcementAction.findFirst({ where: { subjectReviewId: reviewId, type: "VERIFIED_LABEL_REVOKED", status: "ACTIVE" }, select: { id: true } }),
    db.purchaseProof.findFirst({ where: { reviewId, status: { in: ["DRAFT", "PENDING"] } }, select: { id: true } }),
    db.purchaseProof.count({ where: { reviewId, status: "REJECTED" } }),
  ]);
  const deny = proofEligibility({ reviewStatus: review.status, alreadyVerified: !!review.verifiedProofId, labelRevoked: !!revoked, openProof: !!open, rejectedCount: rejected });
  if (deny) throw new HttpError(deny.status, deny.code, deny.code);
  if (input.consentVersion !== PROOF_CONSENT_VERSION) throw new HttpError(400, "consent_required", "Consent to the current proof terms is required");
  const marketplace = input.method === "MARKETPLACE_ORDER_LINK";
  if (marketplace !== !!input.marketplace || (marketplace && !input.orderReference) || (!marketplace && input.orderReference)) throw new HttpError(400, "validation_error", "marketplace and orderReference apply to MARKETPLACE_ORDER_LINK only");
  let hash: { hash: string; keyId: number } | null = null;
  const dupFlags: string[] = [];
  if (marketplace) {
    const keys = parseOrderRefKeys((ctx.env ?? process.env).ORDER_REF_HMAC_KEYS);
    if (!keys[0]) throw new HttpError(503, "service_unavailable", "Proof verification is temporarily unavailable"); // fail closed: the raw reference is never stored
    hash = hashOrderRef(keys[0], input.marketplace!.toLowerCase(), input.orderReference!);
    // Rotation: a match against ANY key's hash is found (PRV-024). Same order on another account is flagged, never auto-verified (PRV-008).
    const others = await db.purchaseProof.findMany({ where: { orderReferenceHash: { in: orderRefCandidates(keys, input.marketplace!.toLowerCase(), input.orderReference!) } }, select: { submittedById: true, reviewId: true } });
    if (others.some((o) => o.submittedById !== userId)) dupFlags.push("DUPLICATE_ORDER_OTHER_ACCOUNT");
    if (others.some((o) => o.submittedById === userId && o.reviewId !== reviewId)) dupFlags.push("DUPLICATE_ORDER_SAME_ACCOUNT");
  }
  await ctx.charge?.();
  try {
    return await db.$transaction(async (t) => {
      const tx = t as unknown as Db;
      const p = await tx.purchaseProof.create({
        data: {
          reviewId, submittedById: userId, method: input.method, marketplace: input.marketplace ?? null, status: "DRAFT", openKey: reviewId,
          consentVersion: input.consentVersion, consentedAt: now, orderReferenceHash: hash?.hash ?? null, orderReferenceKeyId: hash?.keyId ?? null, ...(dupFlags.length ? { flags: dupFlags } : {}),
        },
        select: { id: true },
      });
      await tx.auditLog.create({ data: { actorType: "USER", actorId: userId, action: "proof.created", entityType: "PurchaseProof", entityId: p.id, metadata: { reviewId, method: input.method } } });
      return { id: p.id, status: "DRAFT" as const };
    });
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, "proof_open_exists", "proof_open_exists");
    throw e;
  }
}

async function ownProof(db: Db, userId: string, proofId: string) {
  const p = await db.purchaseProof.findFirst({ where: { id: proofId, submittedById: userId }, select: { id: true, status: true, reviewId: true } });
  if (!p) throw notFound();
  return p;
}

export async function createProofFileSlot(db: Db, st: Storage, userId: string, proofId: string, input: z.infer<typeof proofFileInput>) {
  const p = await ownProof(db, userId, proofId);
  if (p.status !== "DRAFT") throw new HttpError(409, "proof_not_draft", "proof_not_draft");
  if (input.sizeBytes > MEDIA_MAX_BYTES) throw new HttpError(413, "too_large", "File exceeds 10 MiB");
  if (ALLOWED_MIME[input.mimeType] !== input.kind) throw new HttpError(415, "unsupported_media_type", "Unsupported file type");
  const used = await db.purchaseProofFile.count({ where: { proofId, status: { notIn: ["REJECTED", "FAILED", "PURGED"] } } });
  if (used >= PROOF_MAX_FILES) throw new HttpError(409, "proof_file_limit", "proof_file_limit");
  const f = await db.purchaseProofFile.create({ data: { proofId, ownerId: userId, kind: input.kind, declaredMime: input.mimeType, sizeBytes: input.sizeBytes, storageKey: `pending:${proofId}:${used}:${Date.now()}` }, select: { id: true } });
  const key = proofFileKey(f.id);
  await db.purchaseProofFile.update({ where: { id: f.id }, data: { storageKey: key } });
  const uploadUrl = await st.store.presignPut(st.buckets.ingest, key, { contentType: input.mimeType, contentLength: input.sizeBytes, expiresIn: MEDIA_PUT_TTL_SECONDS });
  // Purpose PURCHASE_PROOF, visibility PRIVATE: never a public key.
  return { fileId: f.id, uploadUrl, method: "PUT" as const, expiresIn: MEDIA_PUT_TTL_SECONDS, headers: { "Content-Type": input.mimeType, "Content-Length": String(input.sizeBytes) } };
}

export async function confirmProofFile(db: Db, userId: string, proofId: string, fileId: string) {
  await ownProof(db, userId, proofId);
  return db.$transaction(async (t) => {
    const tx = t as unknown as Db;
    const r = await tx.purchaseProofFile.updateMany({ where: { id: fileId, proofId, ownerId: userId, status: "UPLOADING" }, data: { status: "PROCESSING" } });
    if (r.count === 1) await tx.outboxEvent.create({ data: { type: "proof.file_uploaded", aggregateId: fileId, payload: { fileId, proofId } } });
    const f = await tx.purchaseProofFile.findFirst({ where: { id: fileId, proofId, ownerId: userId }, select: { id: true, status: true, failureReason: true } });
    if (!f) throw notFound();
    return f;
  });
}

export async function submitProof(db: Db, userId: string, proofId: string, now = new Date()) {
  await ownProof(db, userId, proofId);
  return db.$transaction(async (t) => {
    const tx = t as unknown as Db;
    const files = await tx.purchaseProofFile.count({ where: { proofId, status: { in: ["PROCESSING", "READY"] }, isRedacted: false } });
    const cur = await tx.purchaseProof.findUnique({ where: { id: proofId }, select: { status: true, reviewId: true, method: true } });
    if (cur?.status !== "DRAFT") throw new HttpError(409, "proof_not_draft", "proof_not_draft");
    if (files < 1) throw new HttpError(409, "proof_files_missing", "proof_files_missing");
    const slaDueAt = new Date(now.getTime() + PROOF_SLA_HOURS * 3_600_000);
    const res = await tx.purchaseProof.updateMany({ where: { id: proofId, status: "DRAFT" }, data: { status: "PENDING", submittedAt: now, slaDueAt } });
    if (res.count !== 1) throw new HttpError(409, "proof_not_draft", "proof_not_draft");
    await tx.auditLog.create({ data: { actorType: "USER", actorId: userId, action: "proof.submitted", entityType: "PurchaseProof", entityId: proofId, metadata: { reviewId: cur.reviewId, method: cur.method } } });
    await tx.outboxEvent.create({ data: { type: "proof.submitted", aggregateId: proofId, payload: { proofId } } });
    return { status: "PENDING" as const, slaDueAt };
  });
}

/** Own proofs: status, method, dates, reasons. No staff identity, no flags. */
export async function listOwnProofs(db: Db, userId: string, reviewId: string) {
  const r = await db.review.findFirst({ where: { id: reviewId, authorId: userId }, select: { id: true } });
  if (!r) throw notFound();
  return db.purchaseProof.findMany({
    where: { reviewId }, orderBy: { createdAt: "desc" },
    select: { id: true, status: true, method: true, submittedAt: true, slaDueAt: true, reviewedAt: true, decisionReasonCode: true, closeReason: true, closedAt: true, createdAt: true },
  });
}

/** DRAFT/PENDING -> WITHDRAWN. Files are purged within 24 h by the retention job. A VERIFIED label stays (L-7, PRV-007). */
export async function withdrawProof(db: Db, userId: string, proofId: string, now = new Date()) {
  const p = await ownProof(db, userId, proofId);
  await db.$transaction(async (t) => {
    const tx = t as unknown as Db;
    if (p.status === "DRAFT" || p.status === "PENDING") {
      const r = await tx.purchaseProof.updateMany({ where: { id: proofId, status: p.status }, data: { status: "WITHDRAWN", closeReason: "USER_WITHDRAWN", closedAt: now, openKey: null, filesDeleteRequestedAt: now } });
      if (r.count !== 1) throw new HttpError(409, "invalid_transition", "Proof changed, reload");
      await tx.auditLog.create({ data: { actorType: "USER", actorId: userId, action: "proof.withdrawn", entityType: "PurchaseProof", entityId: proofId, metadata: { reviewId: p.reviewId } } });
    } else {
      await tx.purchaseProof.updateMany({ where: { id: proofId, filesDeleteRequestedAt: null }, data: { filesDeleteRequestedAt: now } });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Staff (m4-m5-spec 5.6). Staff never receive originals: only redacted derivatives are signed.
// ---------------------------------------------------------------------------------------------------------------------

export async function listProofQueue(db: Db, actor: Actor, page = 1, pageSize = 20) {
  staff(actor);
  const where = { status: "PENDING" as const, filesReadyAt: { not: null } };
  const [items, total] = await Promise.all([
    db.purchaseProof.findMany({
      where, orderBy: [{ slaDueAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, reviewId: true, method: true, marketplace: true, slaDueAt: true, filesReadyAt: true, flags: true, merchantName: true, purchaseDate: true, redactionMode: true, aiAssessment: true },
    }),
    db.purchaseProof.count({ where }),
  ]);
  return { items, page, pageSize, total };
}

async function assertNoCoi(tx: Db, actor: Actor, review: { authorId: string; product: { sellerId: string | null } | null }) {
  if (review.authorId === actor.id) throw new HttpError(403, "CONFLICT_OF_INTEREST", "You cannot act on your own review");
  const sellerId = review.product?.sellerId;
  if (sellerId) {
    const m = await tx.sellerMember.findUnique({ where: { sellerId_userId: { sellerId, userId: actor.id } }, select: { userId: true } });
    if (m) throw new HttpError(403, "CONFLICT_OF_INTEREST", "You are a member of this seller");
  }
}

export async function getProofDetail(db: Db, st: Storage, actor: Actor, proofId: string) {
  staff(actor);
  const p = await db.purchaseProof.findUnique({
    where: { id: proofId },
    select: {
      id: true, status: true, method: true, marketplace: true, flags: true, aiAssessment: true, merchantName: true, purchaseDate: true, redactionMode: true, slaDueAt: true, filesReadyAt: true,
      review: { select: { id: true, authorId: true, product: { select: { sellerId: true, name: true } } } },
      files: { where: { isRedacted: true, status: "READY" }, select: { id: true, storageKey: true, pageCount: true, isRedacted: true, status: true } },
    },
  });
  if (!p) throw notFound();
  await assertNoCoi(db, actor, p.review);
  // Redacted derivatives only. 300 s signed URLs; every view is audited (R-2). No route returns an original.
  const files = await Promise.all(p.files.filter((f) => f.isRedacted && f.status === "READY").map(async (f) => ({ id: f.id, pageCount: f.pageCount, url: await st.store.presignGet(st.buckets.private, f.storageKey, Math.min(300, MEDIA_GET_TTL_SECONDS)) })));
  await db.auditLog.create({ data: { actorType: "STAFF", actorId: actor.id, action: "proof.view_redacted", entityType: "PurchaseProof", entityId: proofId, metadata: { fileCount: files.length } } });
  const { files: _drop, review, ...rest } = p; void _drop;
  return { ...rest, reviewId: review.id, productName: review.product?.name ?? null, files };
}

export async function decideProof(db: Db, actor: Actor, proofId: string, input: z.infer<typeof proofDecisionInput>, ctx: { now?: Date; originalRetention?: ProofOriginalRetention } = {}) {
  staff(actor);
  const now = ctx.now ?? new Date();
  if (input.outcome === "REJECTED" && !input.reasonCode) throw new HttpError(400, "reason_required", "reason_required");
  return db.$transaction(async (t) => {
    const tx = t as unknown as Db;
    const p = await tx.purchaseProof.findUnique({ where: { id: proofId }, select: { id: true, status: true, filesReadyAt: true, method: true, reviewId: true, submittedById: true, flags: true, review: { select: { authorId: true, product: { select: { sellerId: true } } } } } });
    if (!p) throw notFound();
    await assertNoCoi(tx, actor, p.review);
    if (p.status !== "PENDING") throw new HttpError(409, "invalid_transition", "invalid_transition");
    if (!p.filesReadyAt) throw new HttpError(409, "proof_not_ready", "proof_not_ready");
    const ret = proofRetention(now, ctx.originalRetention ?? ((process.env.PROOF_ORIGINAL_RETENTION as ProofOriginalRetention | undefined) ?? "AT_DECISION"));
    // Conditional update: concurrent decisions produce one commit, the other gets 409.
    const res = await tx.purchaseProof.updateMany({
      where: { id: proofId, status: "PENDING", filesReadyAt: { not: null } },
      data: { status: input.outcome, openKey: null, reviewedById: actor.id, reviewedAt: now, decisionReasonCode: input.outcome === "REJECTED" ? input.reasonCode! : null, decisionNote: input.note ?? null, retainFilesUntil: ret.redactedPurgeAt },
    });
    if (res.count !== 1) throw new HttpError(409, "invalid_transition", "invalid_transition");
    if (input.outcome === "VERIFIED") {
      // The only place the label is set: all three fields together (chk_review_verified_label). The legacy boolean mirrors it.
      const r = await tx.review.updateMany({
        where: { id: p.reviewId, verifiedProofId: null, status: { notIn: ["DELETED", "REMOVED"] } },
        data: { verifiedPurchaseAt: now, verificationMethod: p.method, verifiedProofId: proofId, verifiedBuyer: true, verifiedAt: now },
      });
      if (r.count !== 1) throw new HttpError(409, "review_not_verifiable", "review_not_verifiable");
    }
    const fraud = input.outcome === "REJECTED" && FRAUD_REASONS.includes(input.reasonCode!);
    if (input.outcome === "VERIFIED" || fraud) {
      await tx.trustSignal.create({ data: { type: input.outcome === "VERIFIED" ? "VERIFIED_PURCHASE" : "PROOF_REJECTED_FRAUD", userId: p.submittedById, sourceType: "PurchaseProof", sourceId: proofId } });
    }
    await tx.auditLog.create({
      data: { actorType: "STAFF", actorId: actor.id, action: input.outcome === "VERIFIED" ? "proof.verified" : "proof.rejected", entityType: "PurchaseProof", entityId: proofId, metadata: { reviewId: p.reviewId, reasonCode: input.reasonCode ?? null, flags: Array.isArray(p.flags) ? p.flags : [] } },
    });
    await tx.outboxEvent.create({ data: { type: "proof.decided", aggregateId: proofId, payload: { proofId, outcome: input.outcome } } });
    // AT_DECISION: originals are purged through the media group, requested in the same transaction.
    if (ret.originalPurgeAt <= now) await tx.outboxEvent.create({ data: { type: "proof.purge_requested", aggregateId: proofId, payload: { proofId, rule: "PROOF_ORIGINAL" } } });
    return { id: proofId, status: input.outcome };
  });
}

/** Label revocation (PRV-013): admin tier, step-up (route), COI. One transaction; the proof row is unchanged. */
export async function revokeVerifiedLabel(db: Db, actor: Actor, reviewId: string, input: z.infer<typeof labelRevokeInput>) {
  staff(actor);
  return db.$transaction(async (t) => {
    const tx = t as unknown as Db;
    const review = await tx.review.findUnique({ where: { id: reviewId }, select: { id: true, authorId: true, verifiedProofId: true, product: { select: { sellerId: true } } } });
    if (!review) throw notFound();
    await assertNoCoi(tx, actor, review);
    if (!review.verifiedProofId) throw new HttpError(409, "invalid_transition", "Review has no verified label");
    const enf = await tx.enforcementAction.create({
      data: { type: "VERIFIED_LABEL_REVOKED", subjectUserId: review.authorId, subjectReviewId: reviewId, reasonCode: input.reasonCode, publicReason: input.publicReason, issuedById: actor.id },
      select: { id: true },
    });
    const r = await tx.review.updateMany({ where: { id: reviewId, verifiedProofId: review.verifiedProofId }, data: { verifiedPurchaseAt: null, verificationMethod: null, verifiedProofId: null, verifiedBuyer: false, verifiedAt: null } });
    if (r.count !== 1) throw new HttpError(409, "invalid_transition", "Label changed, reload");
    await tx.auditLog.create({ data: { actorType: "STAFF", actorId: actor.id, action: "review.verified_label_revoked", entityType: "Review", entityId: reviewId, metadata: { proofId: review.verifiedProofId, enforcementId: enf.id, reasonCode: input.reasonCode } } });
    await tx.outboxEvent.create({ data: { type: "review.verified_label_revoked", aggregateId: reviewId, payload: { reviewId, enforcementId: enf.id } } });
    return { reviewId, enforcementId: enf.id };
  });
}
