import { createHash } from "node:crypto";
import sharp from "sharp";
import { evaluateFreshness, ScannerUnavailable, type Scanner } from "./media/clamd";
import { PdfReject, inspectPdf, rasterisePdf, type PdfRasteriser } from "./media/pdf";
import { detectType, findPolyglot } from "./media/validate";
import type { PrismaClient } from "@rp/db";
import {
  MEDIA_MAX_BYTES, MEDIA_MAX_PIXELS, PROOF_DRAFT_TTL_HOURS, appUrl, hashOrderRef, proofRetention, quarantineKey, renderMail, sanitizeAssessment,
  type MailProvider, type ObjectStore, type OrderRefKey, type ProofAssessment, type ProofFlagT, type ProofOriginalRetention,
} from "@rp/core";

/** Verified Buyer proof jobs (ADR-0008 / ADR-0022, m4-m5-spec 5.5-5.8). The label is NEVER set here: only a staff decision sets it. */
type Db = PrismaClient;
export interface ProofDeps {
  db: Db;
  store: ObjectStore;
  buckets: { ingest: string; private: string };
  redactor: Redactor;
  /** SEC-M5-02: every proof original is AV-scanned before it is stored. */
  scanner?: Scanner;
  /** MED-046: PDF page rasteriser (default: sandboxed pdfinfo + pdftoppm). */
  rasterise?: PdfRasteriser;
  keys: OrderRefKey[];
  now?: () => Date;
}

/** OCR + PII masking port (runs in the `media` group, no external network). The OCR adapter lands with M5-02. */
export interface RedactionResult {
  /** Re-encoded from pixels, solid-black masks, no layers. */
  png: Buffer;
  mode: "AUTO" | "FULL_MASK";
  flags: ProofFlagT[];
  /** Detected order number, hashed in memory by the caller and dropped. Never persisted or logged. */
  orderRef?: string;
  merchantSlug?: string;
}
/** Longest side of a redacted master (m4-m5-spec 8.3). */
export const PROOF_MASK_MAX_SIDE = 4096;
export interface Redactor { redact(input: { bytes: Buffer; mime: string }): Promise<RedactionResult> }

/** Fail-closed default (PRV-005): without a trained OCR adapter every page is fully masked. PDFs need the rasteriser (M5-02) and fail. */
export const failClosedRedactor: Redactor = {
  async redact({ bytes, mime }) {
    if (mime === "application/pdf") throw new Error("pdf_rasteriser_unavailable");
    // SEC-M5-02: header-only metadata read under the shared pixel limit; the mask canvas is capped (long side 4096, spec 8.3), never the decoded size.
    const m = await sharp(bytes, { failOn: "error", limitInputPixels: MEDIA_MAX_PIXELS }).rotate().metadata();
    const swap = (m.orientation ?? 1) >= 5;
    const w = (swap ? m.height : m.width) ?? 1, h = (swap ? m.width : m.height) ?? 1;
    const k = Math.min(1, PROOF_MASK_MAX_SIDE / Math.max(w, h));
    const png = await sharp({ create: { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), channels: 3, background: "#000" } }).png().toBuffer();
    return { png, mode: "FULL_MASK", flags: ["REDACTION_FULL_MASK", "REDACTION_UNREADABLE"] };
  },
};

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const origKey = (id: string) => `proof/${id}/orig`;
const redKey = (id: string) => `proof/${id}/redacted.png`;
const clock = (d: { now?: () => Date }) => (d.now ?? (() => new Date()))();

/** Validate -> store original privately -> redact -> derivative. Never persists OCR text, boxes or the raw order number (PRV-001). */
export async function processProofFile(d: ProofDeps, fileId: string): Promise<"READY" | "REJECTED" | "FAILED" | "SKIPPED"> {
  const f = await d.db.purchaseProofFile.findUnique({ where: { id: fileId }, select: { id: true, proofId: true, status: true, isRedacted: true, declaredMime: true, storageKey: true, sizeBytes: true, proof: { select: { status: true, method: true, marketplace: true, orderReferenceHash: true } } } });
  if (!f || f.isRedacted || f.status !== "PROCESSING") return "SKIPPED";
  const finish = async (status: "REJECTED" | "FAILED", reason: string) => {
    await d.db.purchaseProofFile.updateMany({ where: { id: fileId, status: "PROCESSING" }, data: { status, failureReason: reason } });
    await d.store.delete(d.buckets.ingest, f.storageKey).catch(() => undefined);
    await finalizeProof(d.db, f.proofId, clock(d));
    return status;
  };
  const bytes = await d.store.get(d.buckets.ingest, f.storageKey, MEDIA_MAX_BYTES).catch(() => "too_large" as const);
  if (bytes === "too_large") return finish("REJECTED", "TOO_LARGE");
  if (!bytes) return finish("REJECTED", "NOT_CONFIRMED");
  const typed = detectType(bytes, { allowPdf: true });
  if (!typed || typed.kind === "VIDEO") return finish("REJECTED", "TYPE_NOT_ALLOWED");
  const detected = typed.mime;
  if (detected !== f.declaredMime) return finish("REJECTED", "TYPE_MISMATCH");
  if (typed.kind === "IMAGE" && findPolyglot(bytes)) return finish("REJECTED", "TYPE_MISMATCH");
  if (typed.kind === "DOCUMENT") {
    try { inspectPdf(bytes); } catch (e) { if (e instanceof PdfReject) return finish("REJECTED", e.reason); throw e; }
  }
  // SEC-M5-02: ClamAV before the original is stored or decoded. Scanner trouble throws (retry); nothing is persisted unscanned.
  if (d.scanner) {
    const ver = await d.scanner.version();
    if (evaluateFreshness(ver, clock(d)).state === "too_old") throw new ScannerUnavailable("scanner: signatures too old");
    const res = await d.scanner.scan(bytes);
    if (!res.clean) {
      await d.store.put(d.buckets.private, quarantineKey(f.id), bytes, "application/octet-stream");
      return finish("REJECTED", "MALWARE");
    }
  }
  let reds: RedactionResult[];
  try {
    if (typed.kind === "DOCUMENT") {
      const pages = await (d.rasterise ?? rasterisePdf)(bytes); // sandboxed; at most 20 pages, encrypted -> CORRUPT
      reds = [];
      for (const page of pages) reds.push(await d.redactor.redact({ bytes: page, mime: "image/png" }));
    } else {
      reds = [await d.redactor.redact({ bytes, mime: detected })];
    }
  } catch (e) {
    if (e instanceof PdfReject) return finish("REJECTED", e.reason);
    return finish("FAILED", "PROCESSING_ERROR"); // fail closed: nothing unredacted is ever exposed
  }
  const orig = origKey(f.id);
  const multi = reds.length > 1 || typed.kind === "DOCUMENT";
  const rks = reds.map((_, i) => (multi ? `proof/${f.id}/redacted.p${i + 1}.png` : redKey(f.id)));
  await d.store.put(d.buckets.private, orig, bytes, detected);
  for (const [i, red] of reds.entries()) await d.store.put(d.buckets.private, rks[i]!, red.png, "image/png");
  await d.store.delete(d.buckets.ingest, f.storageKey).catch(() => undefined);
  const first = reds.find((r) => r.orderRef);
  const hash = d.keys[0] && first?.orderRef && !f.proof.orderReferenceHash ? hashOrderRef(d.keys[0], first.merchantSlug ?? "unknown", first.orderRef) : null;
  const flagsNew = [...new Set(reds.flatMap((r) => r.flags))];
  const fullMask = reds.some((r) => r.mode === "FULL_MASK");
  await d.db.$transaction(async (tx) => {
    await tx.purchaseProofFile.updateMany({ where: { id: f.id, status: "PROCESSING" }, data: { status: "READY", detectedMime: detected, sha256: sha256(bytes), storageKey: orig } });
    const ownerId = (await tx.purchaseProofFile.findUniqueOrThrow({ where: { id: f.id }, select: { ownerId: true } })).ownerId;
    for (const [i, red] of reds.entries()) await tx.purchaseProofFile.create({ data: { proofId: f.proofId, ownerId, kind: "IMAGE", status: "READY", declaredMime: "image/png", detectedMime: "image/png", sizeBytes: red.png.length, storageKey: rks[i]!, isRedacted: true, derivedFromId: f.id, sha256: sha256(red.png) } });
    const p = await tx.purchaseProof.findUniqueOrThrow({ where: { id: f.proofId }, select: { flags: true, redactionMode: true } });
    const flags = [...new Set([...(Array.isArray(p.flags) ? (p.flags as string[]) : []), ...flagsNew])];
    await tx.purchaseProof.update({ where: { id: f.proofId }, data: { flags, redactionMode: fullMask || p.redactionMode === "FULL_MASK" ? "FULL_MASK" : "AUTO", redactedAt: clock(d), ...(hash ? { orderReferenceHash: hash.hash, orderReferenceKeyId: hash.keyId } : {}) } });
  });
  await finalizeProof(d.db, f.proofId, clock(d));
  return "READY";
}

/** When every original file of a PENDING proof is terminal: queue it for staff (`filesReadyAt`), or EXPIRED(NO_VALID_FILES). */
export async function finalizeProof(db: Db, proofId: string, now: Date): Promise<"READY" | "EXPIRED" | "WAITING"> {
  return db.$transaction(async (tx) => {
    const p = await tx.purchaseProof.findUnique({ where: { id: proofId }, select: { status: true, filesReadyAt: true } });
    if (!p || p.status !== "PENDING" || p.filesReadyAt) return "WAITING" as const;
    const originals = await tx.purchaseProofFile.findMany({ where: { proofId, isRedacted: false }, select: { status: true } });
    if (originals.some((f) => f.status === "UPLOADING" || f.status === "PROCESSING") || originals.length === 0) return "WAITING" as const;
    const usable = originals.some((f) => f.status === "READY");
    if (usable) {
      const r = await tx.purchaseProof.updateMany({ where: { id: proofId, status: "PENDING", filesReadyAt: null }, data: { filesReadyAt: now } });
      if (r.count === 1) await tx.outboxEvent.create({ data: { type: "proof.files_ready", aggregateId: proofId, payload: { proofId } } });
      return "READY" as const;
    }
    const r = await tx.purchaseProof.updateMany({ where: { id: proofId, status: "PENDING" }, data: { status: "EXPIRED", closeReason: "NO_VALID_FILES", closedAt: now, openKey: null, filesDeleteRequestedAt: now } });
    if (r.count === 1) await tx.outboxEvent.create({ data: { type: "proof.expired", aggregateId: proofId, payload: { proofId, closeReason: "NO_VALID_FILES" } } });
    return "EXPIRED" as const;
  }) as Promise<"READY" | "EXPIRED" | "WAITING">;
}

// ---------------------------------------------------------------------------------------------------------------------
// verification.assess-proof (core group). Hints only: it never decides (R-10, ADR-0008 section 4).
// ---------------------------------------------------------------------------------------------------------------------

/** The extractor receives REDACTED page images plus the product's name and brand only (PRV-004). */
export interface ProofExtractor {
  extract(input: { pages: Buffer[]; productName: string; brand: string | null }): Promise<unknown>;
}
export interface AssessDeps {
  db: Db;
  store: ObjectStore;
  buckets: { ingest: string; private: string };
  extractor: ProofExtractor | null;
  /** Daily budget gate (PROOF_AI_DAILY_BUDGET); returns false when spent. */
  takeBudget: () => Promise<boolean>;
  keys: OrderRefKey[];
  now?: () => Date;
}

export async function assessProof(d: AssessDeps, proofId: string): Promise<"ASSESSED" | "SKIPPED_HINTS" | "NOOP"> {
  const now = clock(d);
  const p = await d.db.purchaseProof.findUnique({
    where: { id: proofId },
    select: { id: true, status: true, filesReadyAt: true, assessedAt: true, submittedById: true, reviewId: true, orderReferenceHash: true, marketplace: true, review: { select: { createdAt: true, product: { select: { name: true } } } }, files: { select: { id: true, isRedacted: true, status: true, sha256: true, storageKey: true } } },
  });
  if (!p || p.status !== "PENDING" || !p.filesReadyAt || p.assessedAt) return "NOOP";
  const cur = await d.db.purchaseProof.findUnique({ where: { id: proofId }, select: { flags: true } });
  const flags = new Set<ProofFlagT>(Array.isArray(cur?.flags) ? (cur!.flags as ProofFlagT[]) : []);
  let assessment: ProofAssessment | null = null;
  let skipped: "BUDGET" | "PROVIDER_ERROR" | null = null;
  if (!d.extractor || !(await d.takeBudget())) skipped = "BUDGET";
  else {
    try {
      const pages: Buffer[] = [];
      for (const f of p.files.filter((x) => x.isRedacted && x.status === "READY")) {
        const b = await d.store.get(d.buckets.private, f.storageKey, MEDIA_MAX_BYTES);
        if (b) pages.push(b);
      }
      assessment = sanitizeAssessment({ ...(await d.extractor.extract({ pages, productName: p.review.product?.name ?? "", brand: null }) as object) });
    } catch {
      skipped = "PROVIDER_ERROR"; // after the job retries; the proof still reaches the queue without hints
    }
  }
  if (skipped) flags.add("AI_SKIPPED");
  for (const f of assessment?.flags ?? []) flags.add(f);
  if (assessment?.purchaseDate) {
    const when = new Date(assessment.purchaseDate.date);
    if (when.getTime() > now.getTime()) flags.add("DATE_IN_FUTURE");
    if (when.getTime() > p.review.createdAt.getTime()) flags.add("DATE_AFTER_REVIEW");
  }
  if ((assessment?.productMatch ?? 1) < 0.5) flags.add("PRODUCT_MISMATCH");
  if (assessment && !assessment.merchant) flags.add("MERCHANT_UNKNOWN");

  // Duplicate checks (tombstones included: sha256 is kept after purge).
  const shas = p.files.filter((f) => !f.isRedacted && f.sha256).map((f) => f.sha256!);
  const sameFile = shas.length ? await d.db.purchaseProofFile.findMany({ where: { sha256: { in: shas }, isRedacted: false, proofId: { not: proofId } }, select: { proof: { select: { submittedById: true } } } }) : [];
  if (sameFile.length) flags.add("DUPLICATE_FILE");
  const dupSignal = async (sourceId = proofId) => d.db.trustSignal.upsert({ where: { type_sourceType_sourceId_userId: { type: "DUPLICATE_PROOF_DETECTED", sourceType: "PurchaseProof", sourceId, userId: p.submittedById } }, create: { type: "DUPLICATE_PROOF_DETECTED", sourceType: "PurchaseProof", sourceId, userId: p.submittedById }, update: {} });
  let signal = sameFile.some((s) => s.proof.submittedById !== p.submittedById);
  if (p.orderReferenceHash) {
    // Matches against older keys' hashes are flagged at creation, when the raw reference is still in memory (createProof, PRV-024).
    const others = await d.db.purchaseProof.findMany({ where: { orderReferenceHash: p.orderReferenceHash, id: { not: proofId } }, select: { submittedById: true, reviewId: true } });
    if (others.some((o) => o.submittedById !== p.submittedById)) { flags.add("DUPLICATE_ORDER_OTHER_ACCOUNT"); signal = true; }
    if (others.some((o) => o.submittedById === p.submittedById && o.reviewId !== p.reviewId)) flags.add("DUPLICATE_ORDER_SAME_ACCOUNT");
  }
  if (signal) await dupSignal();
  const stored: ProofAssessment = assessment ?? sanitizeAssessment({ provider: "none", model: "none", promptVersion: "0", flags: [], skipped });
  const merchant = assessment?.merchant?.name ?? null;
  await d.db.purchaseProof.updateMany({
    where: { id: proofId, assessedAt: null },
    data: { aiAssessment: { ...stored, ...(skipped ? { skipped } : {}), flags: [...flags] }, flags: [...flags], assessedAt: now, merchantName: merchant, ...(assessment?.purchaseDate ? { purchaseDate: new Date(assessment.purchaseDate.date) } : {}) },
  });
  return skipped ? "SKIPPED_HINTS" : "ASSESSED";
}

// ---------------------------------------------------------------------------------------------------------------------
// Purge and retention (m4-m5-spec 5.8)
// ---------------------------------------------------------------------------------------------------------------------

/** Deletes the objects of a proof. `filesPurgedAt` is set only after a HEAD returns 404 for every key (PRV-006). Legal hold blocks. */
export async function purgeProofFiles(d: Pick<ProofDeps, "db" | "store" | "buckets" | "now">, proofId: string, rule: "PROOF_ORIGINAL" | "ALL"): Promise<"PURGED" | "HELD" | "PARTIAL" | "NOOP"> {
  const p = await d.db.purchaseProof.findUnique({ where: { id: proofId }, select: { id: true, legalHold: true, filesPurgedAt: true, files: { select: { id: true, isRedacted: true, storageKey: true, status: true } } } });
  if (!p) return "NOOP";
  if (p.legalHold) return "HELD";
  const targets = p.files.filter((f) => (rule === "ALL" || !f.isRedacted) && f.status !== "PURGED");
  const now = clock(d);
  for (const f of targets) {
    for (const [bucket, key] of [[d.buckets.private, f.storageKey], [d.buckets.ingest, `in/proof/${f.id}`]] as const) await d.store.delete(bucket, key).catch(() => undefined);
  }
  for (const f of targets) {
    const gone = (await d.store.head(d.buckets.private, f.storageKey)) === null && (await d.store.head(d.buckets.ingest, `in/proof/${f.id}`)) === null;
    if (!gone) return "PARTIAL"; // retried by the sweep
  }
  await d.db.purchaseProofFile.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data: { status: "PURGED", purgedAt: now } });
  await d.db.purchaseProof.updateMany({ where: { id: proofId }, data: rule === "ALL" ? { filesPurgedAt: now, originalPurgedAt: now } : { originalPurgedAt: now } });
  return "PURGED";
}

export interface SweepDeps extends Pick<ProofDeps, "db" | "store" | "buckets" | "now"> { originalRetention?: ProofOriginalRetention }

/** maintenance.proof-retention: abandoned drafts, SLA expiry, deletion requests, original and redacted retention. Idempotent. */
export async function sweepProofs(d: SweepDeps, batch = 100) {
  const now = clock(d);
  const out = { draftsExpired: 0, slaExpired: 0, purged: 0 };
  const drafts = await d.db.purchaseProof.updateMany({ where: { status: "DRAFT", createdAt: { lt: new Date(now.getTime() - PROOF_DRAFT_TTL_HOURS * 3_600_000) } }, data: { status: "EXPIRED", closeReason: "DRAFT_ABANDONED", closedAt: now, openKey: null, filesDeleteRequestedAt: now } });
  out.draftsExpired = drafts.count;
  const due = await d.db.purchaseProof.findMany({ where: { status: "PENDING", slaDueAt: { lt: now } }, select: { id: true }, take: batch });
  for (const p of due) {
    const r = await d.db.$transaction(async (tx) => {
      const u = await tx.purchaseProof.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "EXPIRED", closeReason: "SLA_EXPIRED", closedAt: now, openKey: null, filesDeleteRequestedAt: now } });
      if (u.count === 1) await tx.outboxEvent.create({ data: { type: "proof.expired", aggregateId: p.id, payload: { proofId: p.id, closeReason: "SLA_EXPIRED" } } });
      return u.count;
    });
    out.slaExpired += r;
  }
  const mode = d.originalRetention ?? "AT_DECISION";
  const decided = await d.db.purchaseProof.findMany({ where: { status: { in: ["VERIFIED", "REJECTED"] }, originalPurgedAt: null, legalHold: false }, select: { id: true, reviewedAt: true }, take: batch });
  for (const p of decided) if (p.reviewedAt && proofRetention(p.reviewedAt, mode).originalPurgeAt <= now && (await purgeProofFiles(d, p.id, "PROOF_ORIGINAL")) === "PURGED") out.purged++;
  const expiredCopies = await d.db.purchaseProof.findMany({ where: { filesPurgedAt: null, legalHold: false, OR: [{ retainFilesUntil: { lte: now } }, { filesDeleteRequestedAt: { not: null } }] }, select: { id: true }, take: batch });
  for (const p of expiredCopies) if ((await purgeProofFiles(d, p.id, "ALL")) === "PURGED") out.purged++;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Vote maintenance (m4-m5-spec 2.1, L-11)
// ---------------------------------------------------------------------------------------------------------------------

/** maintenance.vote-counts: recompute the cached counters from the vote rows and log any drift. */
export async function reconcileVoteCounts(db: Db, log: (m: object) => void = (m) => console.warn(JSON.stringify(m))): Promise<number> {
  const rows = await db.reviewVote.groupBy({ by: ["reviewId", "value"], _count: { _all: true } });
  const want = new Map<string, { h: number; n: number }>();
  for (const r of rows) {
    const e = want.get(r.reviewId) ?? { h: 0, n: 0 };
    if (r.value === "HELPFUL") e.h = r._count._all; else e.n = r._count._all;
    want.set(r.reviewId, e);
  }
  const reviews = await db.review.findMany({ where: { OR: [{ helpfulCount: { gt: 0 } }, { notHelpfulCount: { gt: 0 } }, { id: { in: [...want.keys()] } }] }, select: { id: true, helpfulCount: true, notHelpfulCount: true } });
  let fixed = 0;
  for (const r of reviews) {
    const w = want.get(r.id) ?? { h: 0, n: 0 };
    if (w.h === r.helpfulCount && w.n === r.notHelpfulCount) continue;
    log({ msg: "vote_counts.drift", reviewId: r.id, had: [r.helpfulCount, r.notHelpfulCount], want: [w.h, w.n] });
    await db.review.update({ where: { id: r.id }, data: { helpfulCount: w.h, notHelpfulCount: w.n } });
    fixed++;
  }
  return fixed;
}

/** L-11: ipHash on votes and reports is nulled after 90 days. */
export async function nullOldIpHashes(db: Db, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 90 * 86_400_000);
  const [v, r] = await Promise.all([
    db.reviewVote.updateMany({ where: { createdAt: { lt: before }, ipHash: { not: null } }, data: { ipHash: null } }),
    db.report.updateMany({ where: { createdAt: { lt: before }, ipHash: { not: null } }, data: { ipHash: null } }),
  ]);
  return v.count + r.count;
}

// ---------------------------------------------------------------------------------------------------------------------
// Notices (mandatory email, m4-m5-spec 5.9 / 4.2). Bodies carry no evidence, report details or reasons beyond the code mapping.
// ---------------------------------------------------------------------------------------------------------------------

const PROOF_HEADLINES: Record<string, string> = {
  VERIFIED: "Your purchase was verified",
  REJECTED: "We could not verify your purchase",
  EXPIRED: "Your purchase proof expired, you can submit it again",
};

export async function sendProofNotice(d: { db: Db; mail: MailProvider }, event: string, entityId: string, payload: { outcome?: string; enforcementId?: string; caseId?: string }, jobKey: string): Promise<"SENT" | "SKIPPED"> {
  let userId: string | null = null, headline = "", detail = "";
  if (event === "proof.decided" || event === "proof.expired") {
    const p = await d.db.purchaseProof.findUnique({ where: { id: entityId }, select: { submittedById: true, decisionReasonCode: true } });
    userId = p?.submittedById ?? null;
    headline = PROOF_HEADLINES[event === "proof.expired" ? "EXPIRED" : payload.outcome ?? ""] ?? "";
    detail = p?.decisionReasonCode ? `Reason: ${p.decisionReasonCode.toLowerCase().replace(/_/g, " ")}.` : "";
  } else if (event === "review.removed") {
    const e = payload.caseId ? await d.db.enforcementAction.findFirst({ where: { caseId: payload.caseId, type: "CONTENT_REMOVAL" }, select: { subjectUserId: true, publicReason: true, reasonCode: true } }) : null;
    // RPT-005 (statement of reasons): the notice carries both the reason category and the staff's public reason.
    userId = e?.subjectUserId ?? null; headline = "Your review was removed";
    detail = [e?.reasonCode ? `Reason: ${e.reasonCode.toLowerCase().replace(/_/g, " ")}.` : "", e?.publicReason ?? ""].filter(Boolean).join(" ");
  } else if (event === "review.verified_label_revoked") {
    const e = payload.enforcementId ? await d.db.enforcementAction.findUnique({ where: { id: payload.enforcementId }, select: { subjectUserId: true, publicReason: true } }) : null;
    userId = e?.subjectUserId ?? null; headline = "The verified purchase label was removed from your review"; detail = e?.publicReason ?? "";
  }
  if (!userId || !headline) return "SKIPPED";
  const u = await d.db.user.findUnique({ where: { id: userId }, select: { email: true, status: true } });
  if (!u || u.status !== "ACTIVE") return "SKIPPED";
  await d.mail.send(renderMail("claim_notice", u.email, { url: `${appUrl()}/account`, headline: detail ? `${headline}. ${detail}` : headline }), { idempotencyKey: `${jobKey}:${userId}` });
  return "SENT";
}
