import { addMs, type Clock, type LedgerWriter, type ObjectStore } from "@rp/core";
import { purgeProofFiles } from "../proofs";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** `account.erase` (ADR-0033 §1, spec 22.2): idempotent, resumable by step; each step is recorded on `ErasureRequest.steps`. */
export const ERASURE_STEPS = ["anonymise", "sessions", "proofs", "media", "social", "notifications", "ipHash"] as const;
export type ErasureStep = (typeof ERASURE_STEPS)[number];
export interface EraseDeps { db: any; store: ObjectStore; buckets: { ingest: string; private: string; public: string }; clock: Clock; ledger?: LedgerWriter; random?: () => string }

const MEDIA_KEYS = ["thumbKey", "mediumKey", "videoKey", "posterKey"] as const;

/** Anonymised author label for public DTOs: an erased account renders as "Former user" with no link. */
export const publicAuthor = (u: { status: string; handle: string; displayName: string }) => (u.status === "DELETED" ? { name: "Former user", handle: null } : { name: u.displayName, handle: u.handle });

/** Called by DELETE /api/account after step-up: sets DELETED, creates the request. 409 last_owner is enforced by the caller via `soleOwnerBlock`. */
export async function requestErasure(d: Pick<EraseDeps, "db" | "clock">, userId: string): Promise<{ erasureRequestId: string }> {
  const now = d.clock.now();
  const existing = await d.db.erasureRequest.findUnique({ where: { userId } });
  if (existing) return { erasureRequestId: existing.id };
  await d.db.user.update({ where: { id: userId }, data: { status: "DELETED" } });
  await d.db.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  const r = await d.db.erasureRequest.create({ data: { userId, requestedAt: now, steps: {} } });
  await d.db.outboxEvent.create({ data: { type: "account.erase", aggregateId: r.id, payload: { erasureRequestId: r.id } } });
  return { erasureRequestId: r.id };
}

/** True when the user is the only OWNER of a seller that still has other members (spec 22.2: 409 last_owner, transfer first). */
export async function soleOwnerBlock(db: any, userId: string): Promise<boolean> {
  const owned = await db.sellerMember.findMany({ where: { userId, role: "OWNER" }, select: { sellerId: true } });
  for (const { sellerId } of owned) {
    const members = await db.sellerMember.findMany({ where: { sellerId } });
    const otherOwner = members.some((m: any) => m.role === "OWNER" && m.userId !== userId);
    if (!otherOwner && members.some((m: any) => m.userId !== userId)) return true;
  }
  return false;
}

export async function eraseAccount(d: EraseDeps, erasureRequestId: string): Promise<"DONE" | "PARTIAL" | "NOOP"> {
  const req = await d.db.erasureRequest.findUnique({ where: { id: erasureRequestId } });
  if (!req || req.completedAt) return "NOOP";
  const userId: string = req.userId;
  const steps: Record<string, string> = { ...(req.steps ?? {}) };
  const done = async (s: ErasureStep) => { steps[s] = d.clock.now().toISOString(); await d.db.erasureRequest.update({ where: { id: req.id }, data: { steps } }); };
  const now = d.clock.now();
  let verified = true;

  if (!steps.anonymise) {
    const tag = (d.random ?? (() => Math.random().toString(36).slice(2, 12)))();
    await d.db.user.update({ where: { id: userId }, data: { status: "DELETED", handle: `former-${tag}`, displayName: "Former user", email: `erased-${req.id}@erased.invalid`, bio: null, locale: null, timeZone: null, passwordHash: null, trustScore: null } });
    await d.db.twoFactorTotp.deleteMany({ where: { userId } });
    await d.db.recoveryCode.deleteMany({ where: { userId } });
    // Open appeals by the user are withdrawn; open cases about their content are resolved unless legalHold.
    await d.db.appeal.updateMany({ where: { appellantId: userId, status: { in: ["SUBMITTED", "IN_REVIEW"] } }, data: { status: "WITHDRAWN", leaseExpiresAt: null } });
    await d.db.moderationCase.updateMany({ where: { review: { authorId: userId }, status: { not: "RESOLVED" }, legalHold: false }, data: { status: "RESOLVED", resolutionCode: "WITHDRAWN_BY_AUTHOR", resolvedAt: now, openKey: null } });
    await done("anonymise");
  }
  if (!steps.sessions) { await d.db.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }); await done("sessions"); }
  if (!steps.proofs) {
    const proofs = await d.db.purchaseProof.findMany({ where: { submittedById: userId } });
    for (const p of proofs) {
      if (p.legalHold) continue;
      await d.db.purchaseProof.updateMany({ where: { id: p.id }, data: { filesDeleteRequestedAt: now, merchantName: null, purchaseDate: null, decisionNote: null } });
      const r = await purgeProofFiles({ db: d.db, store: d.store, buckets: d.buckets, now: () => now, ...(d.ledger ? { ledger: d.ledger } : {}) }, p.id, "ALL");
      if (r === "PARTIAL") verified = false;
    }
    if (verified) await done("proofs");
  }
  if (!steps.media) {
    const ok = await purgeMediaObjects(d, await d.db.mediaAsset.findMany({ where: { ownerId: userId, purpose: "REVIEW" } }));
    if (ok.verified) await done("media"); else verified = false;
  }
  if (!steps.social) {
    await d.db.follow.deleteMany({ where: { followerId: userId } }); await d.db.follow.deleteMany({ where: { followedUserId: userId } });
    await d.db.userBlock.deleteMany({ where: { blockerId: userId } }); await d.db.userBlock.deleteMany({ where: { blockedId: userId } });
    await done("social");
  }
  if (!steps.notifications) { await d.db.notification.deleteMany({ where: { recipientId: userId } }); await d.db.notificationPreference.deleteMany({ where: { userId } }); await done("notifications"); }
  if (!steps.ipHash) {
    await d.db.reviewVote.updateMany({ where: { userId }, data: { ipHash: null } });
    await d.db.report.updateMany({ where: { reporterId: userId }, data: { ipHash: null } });
    await d.db.userSession.updateMany({ where: { userId }, data: { ipHash: null } });
    await done("ipHash");
  }
  const complete = verified && ERASURE_STEPS.every((s) => steps[s]);
  if (complete) { await d.db.erasureRequest.update({ where: { id: req.id }, data: { completedAt: addMs(now, 0) } }); return "DONE"; }
  return "PARTIAL"; // retried by the job (idempotent per step)
}

/** Deletes every object of the given assets, verifies HEAD 404, ledgers it, then marks the asset (shared by erasure and RET-MEDIA-REJ / RET-APPEAL-EVID). */
export async function purgeMediaObjects(d: Pick<EraseDeps, "db" | "store" | "buckets" | "clock" | "ledger">, assets: any[]): Promise<{ verified: boolean; purged: number }> {
  const now = d.clock.now();
  const entries: { objectKey: string; entity: string; id: string; purgedAt: string }[] = [];
  let verified = true, purged = 0;
  for (const a of assets) {
    const targets: [string, string][] = [[d.buckets.ingest, a.ingestKey], ...MEDIA_KEYS.filter((k) => a[k]).flatMap((k) => [[d.buckets.private, a[k]], [d.buckets.public, a[k]]] as [string, string][])];
    for (const [b, k] of targets) await d.store.delete(b, k).catch(() => undefined);
    let gone = true;
    for (const [b, k] of targets) if ((await d.store.head(b, k)) !== null) gone = false;
    if (!gone) { verified = false; continue; }
    entries.push(...targets.map(([b, k]) => ({ objectKey: `${b}/${k}`, entity: "MediaAsset", id: a.id, purgedAt: now.toISOString() })));
    await d.db.mediaAsset.updateMany({ where: { id: a.id }, data: { status: "FAILED", failureReason: "ERASED", thumbKey: null, mediumKey: null, videoKey: null, posterKey: null } });
    purged++;
  }
  await d.ledger?.append(entries);
  return { verified, purged };
}
