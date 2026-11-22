import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeModerationDb, moderationJobSchema, transitionCase, type ModerationDb } from "@rp/core";
import { HttpError } from "./http";
import { createReview, editOwnReview, listRevisions, deleteOwnReview } from "./reviews";
import { deleteVote, putVote } from "./votes";
import { createReport, dismissReports, rejectReport, removeReportedContent } from "./reports";
import { createProof, decideProof, getProofDetail, revokeVerifiedLabel, submitProof } from "./proofs";
import { decideCase } from "./moderation";
import { makeFakeDb, matchRow } from "./m4-fake-db";
import { reviewEditInput } from "./validation";
import type { Actor } from "./session";

const NOW = new Date("2026-12-01T12:00:00Z");
const OLD = new Date("2026-01-01T00:00:00Z");
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: HttpError) => `${e.status}:${e.code}`);
const staff = (id: string): Actor => ({ id, role: "admin", twoFactor: { enrolled: true, verified: true } });

function setup() {
  const h = makeFakeDb(
    ["user", "review", "product", "reviewVote", "reviewRevision", "moderationCase", "report", "sellerReply", "sellerMember", "enforcementAction", "auditLog", "outboxEvent", "mediaAsset", "purchaseProof", "purchaseProofFile", "trustSignal"],
    {
      review: (r, t) => ({ product: { sellerId: t.product!.find((p) => p.id === r.productId)?.sellerId ?? null, name: "Widget" } }),
      purchaseProof: (r, t) => ({ review: { ...(t.review!.find((x) => x.id === r.reviewId) ?? {}), product: { sellerId: t.product!.find((p) => p.id === t.review!.find((x) => x.id === r.reviewId)?.productId)?.sellerId ?? null, name: "Widget" } }, files: t.purchaseProofFile!.filter((f) => f.proofId === r.id) }),
    },
    { enforcementAction: { status: "ACTIVE" }, review: { helpfulCount: 0, notHelpfulCount: 0, currentVersion: 1 }, moderationCase: { reportCount: 0, reportWeight: 0, seq: 1, trigger: "SUBMISSION" }, report: { status: "OPEN" }, purchaseProof: { status: "DRAFT" } },
  );
  const { t } = h;
  for (const u of ["author", "voter", "newbie", "seller1", "mod", "mod2"]) t.user!.push({ id: u, status: "ACTIVE", emailVerifiedAt: NOW, createdAt: OLD });
  t.user!.find((u) => u.id === "newbie")!.createdAt = new Date(NOW.getTime() - 86_400_000);
  t.product!.push({ id: "p1", sellerId: "S1", status: "ACTIVE" });
  t.sellerMember!.push({ sellerId: "S1", userId: "seller1" });
  t.review!.push({ id: "r1", productId: "p1", authorId: "author", status: "PUBLISHED", currentVersion: 1, publishedVersion: 1, rating: 5, title: "Great", body: "A perfectly fine long body text.", incentive: "NONE" });
  t.reviewRevision!.push({ reviewId: "r1", version: 1, status: "APPROVED" });
  return h;
}
let h: ReturnType<typeof setup>;
beforeEach(() => { h = setup(); });

describe("REV-001 D-1 regression: outbox payloads parse with moderationJobSchema", () => {
  it("createReview and edit of a PENDING review", async () => {
    h.t.product!.push({ id: "p2", sellerId: null, status: "ACTIVE" });
    const r = await createReview(h.db, "voter", "p2", { rating: 4, title: "ok", body: "a body that is long enough" });
    const ev = h.t.outboxEvent!.at(-1)!;
    expect(ev.type).toBe("review.submitted");
    expect(moderationJobSchema.parse(ev.payload)).toMatchObject({ subjectType: "REVIEW", subjectId: r.id, version: 1, trigger: "SUBMISSION" });
    await editOwnReview(h.db, "voter", r.id, { expectedVersion: 1, title: "better" });
    expect(moderationJobSchema.parse(h.t.outboxEvent!.at(-1)!.payload)).toMatchObject({ version: 2, trigger: "EDIT" });
  });
});

describe("edits and revisions (REV-002..006)", () => {
  it("R1: live edit keeps the old text, writes revision v2 and review.edited", async () => {
    const res = await editOwnReview(h.db, "author", "r1", { expectedVersion: 1, body: "A new and completely different body." });
    expect(res.pendingRevision).toEqual({ version: 2, status: "PENDING" });
    const row = h.t.review![0]!;
    expect(row.body).toBe("A perfectly fine long body text."); // public read unchanged
    expect(row.status).toBe("PUBLISHED");
    expect(row.currentVersion).toBe(2);
    expect(h.t.reviewRevision!.find((x) => x.version === 2)).toMatchObject({ status: "PENDING", body: "A new and completely different body." });
    expect(moderationJobSchema.parse(h.t.outboxEvent!.at(-1)!.payload)).toMatchObject({ trigger: "EDIT", version: 2 });
    expect(h.t.outboxEvent!.at(-1)!.type).toBe("review.edited");
  });
  it("second edit supersedes the first revision and its open case", async () => {
    await editOwnReview(h.db, "author", "r1", { expectedVersion: 1, title: "v2" });
    h.t.moderationCase!.push({ id: "c2", reviewId: "r1", version: 2, state: "AI_REVIEW", trigger: "EDIT" });
    await editOwnReview(h.db, "author", "r1", { expectedVersion: 2, title: "v3" });
    expect(h.t.reviewRevision!.find((x) => x.version === 2)!.status).toBe("SUPERSEDED");
    expect(h.t.moderationCase!.find((c) => c.id === "c2")!.state).toBe("SUPERSEDED");
  });
  it("stale expectedVersion -> version_conflict; rejected/removed -> not_editable; deleted/other user -> 404", async () => {
    expect(await code(editOwnReview(h.db, "author", "r1", { expectedVersion: 7, title: "x" }))).toBe("409:version_conflict");
    expect(await code(editOwnReview(h.db, "voter", "r1", { expectedVersion: 1, title: "x" }))).toBe("404:not_found");
    for (const s of ["REJECTED", "REMOVED"]) { h.t.review![0]!.status = s; expect(await code(editOwnReview(h.db, "author", "r1", { expectedVersion: 1, title: "x" }))).toBe("409:not_editable"); }
    h.t.review![0]!.status = "DELETED";
    expect(await code(editOwnReview(h.db, "author", "r1", { expectedVersion: 1, title: "x" }))).toBe("404:not_found");
  });
  it("limit hook is charged for live edits", async () => {
    const charge = vi.fn(async () => undefined);
    await editOwnReview(h.db, "author", "r1", { expectedVersion: 1, title: "x" }, { charge });
    expect(charge).toHaveBeenCalledWith(true);
  });
  it("revisions visible to author and staff only", async () => {
    expect(await listRevisions(h.db, { id: "author", role: "user" } as Actor, "r1")).toHaveLength(1);
    expect(await listRevisions(h.db, staff("mod"), "r1")).toHaveLength(1);
    expect(await code(listRevisions(h.db, { id: "voter", role: "user" } as Actor, "r1"))).toBe("404:not_found");
  });
  it("media per revision: claim staged asset, remove attached asset; bad ids -> media_not_attachable", async () => {
    h.t.mediaAsset!.push({ id: "m1", reviewId: "r1", ownerId: "author", status: "READY", attachedInVersion: 1, detachedInVersion: null }, { id: "m2", reviewId: "r1", ownerId: "author", status: "READY", attachedInVersion: null, detachedInVersion: null });
    await editOwnReview(h.db, "author", "r1", { expectedVersion: 1, addMediaIds: ["m2"], removeMediaIds: ["m1"] });
    expect(h.t.mediaAsset!.find((m) => m.id === "m2")!.attachedInVersion).toBe(2);
    expect(h.t.mediaAsset!.find((m) => m.id === "m1")!.detachedInVersion).toBe(2);
    expect(await code(editOwnReview(h.db, "author", "r1", { expectedVersion: 2, addMediaIds: ["m1"] }))).toBe("409:media_not_attachable");
  });
  it("delete from PUBLISHED supersedes open cases and withdraws open proofs", async () => {
    h.t.moderationCase!.push({ id: "c9", reviewId: "r1", version: 1, state: "NEEDS_HUMAN" });
    h.t.purchaseProof!.push({ id: "pp1", reviewId: "r1", status: "PENDING", openKey: "r1" });
    await deleteOwnReview(h.db, "author", "r1");
    expect(h.t.review![0]!.status).toBe("DELETED");
    expect(h.t.moderationCase![0]!.state).toBe("SUPERSEDED");
    expect(h.t.purchaseProof![0]).toMatchObject({ status: "WITHDRAWN", openKey: null });
  });
});

describe("votes (VOT-002/004, SEC-009, AZ-012)", () => {
  it("PUT / switch / DELETE keep counters in step; same value is a free no-op", async () => {
    const charge = vi.fn(async () => undefined);
    expect(await putVote(h.db, "voter", "r1", "HELPFUL", { charge })).toMatchObject({ helpfulCount: 1, notHelpfulCount: 0 });
    expect(await putVote(h.db, "voter", "r1", "HELPFUL", { charge })).toMatchObject({ helpfulCount: 1 });
    expect(charge).toHaveBeenCalledTimes(1);
    expect(await putVote(h.db, "voter", "r1", "NOT_HELPFUL", { charge })).toMatchObject({ helpfulCount: 0, notHelpfulCount: 1 });
    expect(await deleteVote(h.db, "voter", "r1")).toMatchObject({ value: null, helpfulCount: 0, notHelpfulCount: 0 });
    expect(await deleteVote(h.db, "voter", "r1")).toMatchObject({ value: null });
    expect(h.t.reviewVote).toHaveLength(0);
  });
  it("self-vote, seller member, restriction, unverified, non-published", async () => {
    expect(await code(putVote(h.db, "author", "r1", "HELPFUL"))).toBe("403:SELF_VOTE");
    expect(await code(putVote(h.db, "seller1", "r1", "HELPFUL"))).toBe("403:CONFLICT_OF_INTEREST");
    h.t.enforcementAction!.push({ subjectUserId: "voter", type: "VOTING_RESTRICTION", status: "ACTIVE", endsAt: null });
    expect(await code(putVote(h.db, "voter", "r1", "HELPFUL"))).toBe("403:VOTING_RESTRICTED");
    h.t.user!.find((u) => u.id === "newbie")!.emailVerifiedAt = null;
    expect(await code(putVote(h.db, "newbie", "r1", "HELPFUL"))).toBe("403:EMAIL_NOT_VERIFIED");
    h.t.review![0]!.status = "REMOVED";
    expect(await code(putVote(h.db, "mod", "r1", "HELPFUL"))).toBe("404:not_found");
  });
  it("charge receives newAccount for accounts younger than 7 days; limiter errors propagate as 429", async () => {
    const charge = vi.fn(async () => { throw new HttpError(429, "rate_limited"); });
    expect(await code(putVote(h.db, "newbie", "r1", "HELPFUL", { charge, now: NOW }))).toBe("429:rate_limited");
    expect(charge).toHaveBeenCalledWith({ newAccount: true });
    expect(h.t.reviewVote).toHaveLength(0);
  });
});

describe("reports (RPT-001..006)", () => {
  it("202 for review and seller reply; own content -> SELF_REPORT; non-public -> 404; repeats are idempotent", async () => {
    h.t.sellerReply!.push({ id: "sr1", reviewId: "r1", sellerId: "S1", authorId: "seller1", status: "PUBLISHED", version: 1 });
    expect(await createReport(h.db, "voter", { reviewId: "r1" }, { reason: "SPAM", details: "canary <script>x</script>" }, { now: NOW })).toEqual({ status: "received" });
    expect(await createReport(h.db, "voter", { reviewId: "r1" }, { reason: "SPAM" }, { now: NOW })).toEqual({ status: "received" });
    expect(h.t.report).toHaveLength(1);
    await createReport(h.db, "voter", { sellerReplyId: "sr1" }, { reason: "OFF_TOPIC" }, { now: NOW });
    expect(await code(createReport(h.db, "author", { reviewId: "r1" }, { reason: "SPAM" }))).toBe("403:SELF_REPORT");
    h.t.review![0]!.status = "PENDING";
    expect(await code(createReport(h.db, "mod", { reviewId: "r1" }, { reason: "SPAM" }))).toBe("404:not_found");
  });
  it("RPT-003: reports from NEW accounts never take content down; one open case, weight 0; details stay out of audit/outbox", async () => {
    for (let i = 0; i < 5; i++) { h.t.user!.push({ id: `n${i}`, status: "ACTIVE", emailVerifiedAt: NOW, createdAt: NOW }); await createReport(h.db, `n${i}`, { reviewId: "r1" }, { reason: "SPAM", details: "CANARY-PII-123" }, { now: NOW }); }
    expect(h.t.review![0]!.status).toBe("PUBLISHED");
    expect(h.t.moderationCase!).toHaveLength(1);
    expect(h.t.moderationCase![0]).toMatchObject({ reportCount: 5, reportWeight: 0, trigger: "USER_REPORT", openReportKey: "R:r1" });
    expect(JSON.stringify([h.t.auditLog, h.t.outboxEvent])).not.toContain("CANARY-PII-123");
  });
  it("RPT-005/006: remove, dismiss, COI, and approve/reject refuse report cases", async () => {
    await createReport(h.db, "voter", { reviewId: "r1" }, { reason: "SPAM" }, { now: NOW });
    const c = h.t.moderationCase![0]!;
    expect(await code(decideCase(h.db, staff("mod"), c.id, "APPROVED"))).toBe("409:invalid_transition");
    h.t.sellerMember!.push({ sellerId: "S1", userId: "mod2" });
    expect(await code(dismissReports(h.db, staff("mod2"), c.id, {}))).toBe("403:CONFLICT_OF_INTEREST");
    expect(await code(removeReportedContent(h.db, staff("author"), c.id, { reasonCode: "SPAM", publicReason: "x" }))).toBe("403:CONFLICT_OF_INTEREST");
    h.t.moderationCase!.push({ id: "other", reviewId: "r1", version: 1, state: "NEEDS_HUMAN", trigger: "EDIT" });
    await removeReportedContent(h.db, staff("mod"), c.id, { reasonCode: "SPAM", publicReason: "Spam content" }, NOW);
    expect(h.t.review![0]!.status).toBe("REMOVED");
    expect(h.t.report![0]!.status).toBe("ACTION_TAKEN");
    expect(h.t.moderationCase!.find((x) => x.id === "other")!.state).toBe("SUPERSEDED");
    expect(h.t.outboxEvent!.at(-1)).toMatchObject({ type: "review.removed" });
    expect(await code(dismissReports(h.db, staff("mod"), c.id, {}))).toBe("409:invalid_transition");
  });
  it("dismiss keeps content live and a later report opens a new case with seq+1 (RPT-008)", async () => {
    await createReport(h.db, "voter", { reviewId: "r1" }, { reason: "SPAM" }, { now: NOW });
    await dismissReports(h.db, staff("mod"), h.t.moderationCase![0]!.id, {}, NOW);
    expect(h.t.report![0]!.status).toBe("NO_ACTION");
    expect(h.t.review![0]!.status).toBe("PUBLISHED");
    h.t.user!.push({ id: "v2", status: "ACTIVE", emailVerifiedAt: NOW, createdAt: OLD });
    await createReport(h.db, "v2", { reviewId: "r1" }, { reason: "SPAM" }, { now: NOW });
    expect(h.t.moderationCase!.map((c) => c.seq)).toEqual([1, 2]);
  });
});

describe("proofs (PRV-014..018)", () => {
  const ENV = { ORDER_REF_HMAC_KEYS: "1:c2VjcmV0LW9uZQ==" };
  const input = { method: "RECEIPT_UPLOAD" as const, consentVersion: "2026-12" };
  it("eligibility matrix", async () => {
    expect(await code(createProof(h.db, "voter", "r1", input))).toBe("404:not_found");
    expect(await code(createProof(h.db, "author", "r1", { ...input, consentVersion: "old" }))).toBe("400:consent_required");
    expect(await code(createProof(h.db, "author", "r1", { method: "MARKETPLACE_ORDER_LINK", consentVersion: "2026-12", marketplace: "AMAZON", orderReference: "123-456" }, { env: {} }))).toBe("503:service_unavailable");
    const p = await createProof(h.db, "author", "r1", input, { env: ENV });
    expect(p.status).toBe("DRAFT");
    expect(h.t.purchaseProof![0]!.openKey).toBe("r1");
    expect(await code(createProof(h.db, "author", "r1", input))).toBe("409:proof_open_exists");
    h.t.purchaseProof!.length = 0;
    h.t.purchaseProof!.push(...[1, 2, 3].map((i) => ({ id: `rej${i}`, reviewId: "r1", status: "REJECTED", openKey: null })));
    expect(await code(createProof(h.db, "author", "r1", input))).toBe("409:proof_attempts_exhausted");
    h.t.purchaseProof!.length = 0;
    h.t.enforcementAction!.push({ subjectReviewId: "r1", type: "VERIFIED_LABEL_REVOKED", status: "ACTIVE" });
    expect(await code(createProof(h.db, "author", "r1", input))).toBe("409:label_revoked");
    h.t.enforcementAction!.length = 0;
    h.t.review![0]!.verifiedProofId = "x";
    expect(await code(createProof(h.db, "author", "r1", input))).toBe("409:already_verified");
  });
  it("marketplace order reference is hashed (HMAC), never stored raw; same order on another account is flagged", async () => {
    const m = { method: "MARKETPLACE_ORDER_LINK" as const, consentVersion: "2026-12", marketplace: "AMAZON" as const, orderReference: "111-2222222" };
    await createProof(h.db, "author", "r1", m, { env: ENV });
    const row = h.t.purchaseProof![0]!;
    expect(row.orderReferenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(h.t)).not.toContain("1112222222");
    h.t.review!.push({ id: "r2", productId: "p1", authorId: "voter", status: "PENDING", currentVersion: 1 });
    await createProof(h.db, "voter", "r2", m, { env: ENV });
    expect(h.t.purchaseProof![1]!.flags).toContain("DUPLICATE_ORDER_OTHER_ACCOUNT");
  });
  const pending = (over = {}) => { h.t.purchaseProof!.push({ id: "pp", reviewId: "r1", submittedById: "author", status: "PENDING", openKey: "r1", method: "RECEIPT_UPLOAD", filesReadyAt: NOW, flags: [], ...over }); };
  it("submit needs a confirmed file; decide needs filesReadyAt; VERIFIED sets the label fields together; second decision 409", async () => {
    h.t.purchaseProof!.push({ id: "pd", reviewId: "r1", submittedById: "author", status: "DRAFT", openKey: "r1", method: "RECEIPT_UPLOAD" });
    expect(await code(submitProof(h.db, "author", "pd"))).toBe("409:proof_files_missing");
    expect(await code(submitProof(h.db, "voter", "pd"))).toBe("404:not_found");
    h.t.purchaseProof!.length = 0;
    pending({ filesReadyAt: null });
    expect(await code(decideProof(h.db, staff("mod"), "pp", { outcome: "VERIFIED" }))).toBe("409:proof_not_ready");
    h.t.purchaseProof![0]!.filesReadyAt = NOW;
    expect(await code(decideProof(h.db, staff("mod"), "pp", { outcome: "REJECTED" }))).toBe("400:reason_required");
    expect(await code(decideProof(h.db, staff("author"), "pp", { outcome: "VERIFIED" }))).toBe("403:CONFLICT_OF_INTEREST");
    await decideProof(h.db, staff("mod"), "pp", { outcome: "VERIFIED" }, { now: NOW });
    expect(h.t.review![0]).toMatchObject({ verifiedProofId: "pp", verificationMethod: "RECEIPT_UPLOAD", verifiedPurchaseAt: NOW });
    expect(h.t.purchaseProof![0]).toMatchObject({ status: "VERIFIED", openKey: null, reviewedById: "mod" });
    expect(h.t.trustSignal![0]).toMatchObject({ type: "VERIFIED_PURCHASE", userId: "author" });
    expect(h.t.outboxEvent!.map((e) => e.type)).toEqual(expect.arrayContaining(["proof.decided", "proof.purge_requested"]));
    expect(await code(decideProof(h.db, staff("mod2"), "pp", { outcome: "VERIFIED" }))).toBe("409:invalid_transition");
  });
  it("rejection with fraud reason writes PROOF_REJECTED_FRAUD and leaves the review unlabelled", async () => {
    pending();
    await decideProof(h.db, staff("mod"), "pp", { outcome: "REJECTED", reasonCode: "SUSPECTED_FORGERY" }, { now: NOW });
    expect(h.t.review![0]!.verifiedProofId ?? null).toBeNull();
    expect(h.t.trustSignal![0]!.type).toBe("PROOF_REJECTED_FRAUD");
  });
  it("PRV-018: staff detail signs redacted pages only and audits each view", async () => {
    pending();
    h.t.purchaseProofFile!.push({ id: "fo", proofId: "pp", isRedacted: false, status: "READY", storageKey: "proof/fo/orig" }, { id: "fr", proofId: "pp", isRedacted: true, status: "READY", storageKey: "proof/fo/redacted.png", pageCount: 1 });
    const signed: string[] = [];
    const st = { store: { presignGet: async (_b: string, k: string) => { signed.push(k); return `https://signed/${k}`; } }, buckets: { ingest: "i", private: "p" } } as never;
    const d = await getProofDetail(h.db, st, staff("mod"), "pp", "Checking the receipt for ticket 123");
    expect(signed).toEqual(["proof/fo/redacted.png"]);
    expect(d.files).toHaveLength(1);
    expect(h.t.auditLog!.at(-1)).toMatchObject({ action: "proof.view_redacted", metadata: { fileCount: 1, accessReason: "Checking the receipt for ticket 123" } });
  });
  it("PRV-013: revocation clears the label, leaves the proof row, writes enforcement + email event", async () => {
    pending();
    await decideProof(h.db, staff("mod"), "pp", { outcome: "VERIFIED" }, { now: NOW });
    await revokeVerifiedLabel(h.db, staff("mod2"), "r1", { reasonCode: "FORGED", publicReason: "Proof was invalid" });
    expect(h.t.review![0]!.verifiedProofId).toBeNull();
    expect(h.t.purchaseProof![0]!.status).toBe("VERIFIED");
    expect(h.t.enforcementAction!.at(-1)).toMatchObject({ type: "VERIFIED_LABEL_REVOKED", subjectReviewId: "r1" });
    expect(h.t.outboxEvent!.at(-1)!.type).toBe("review.verified_label_revoked");
  });
});

// ---- Close-out pack (task #75): QA-M4-01/02, SEC-M4-02/03/04 ----

describe("QA-M4-01 break-glass reason is enforced server-side", () => {
  const st = () => ({ store: { presignGet: async (_b: string, k: string) => `https://signed/${k}` }, buckets: { ingest: "i", private: "p" } }) as never;
  const seed = () => { h.t.purchaseProof!.push({ id: "pp", reviewId: "r1", status: "PENDING", method: "RECEIPT_UPLOAD", filesReadyAt: NOW }); };
  it("QA-M4-01: a missing, blank, short or over-long reason is 400 reason_required and writes no audit row", async () => {
    seed();
    for (const r of [undefined, null, "", "   ", "too short", "x".repeat(201)]) expect(await code(getProofDetail(h.db, st(), staff("mod"), "pp", r))).toBe("400:reason_required");
    expect(h.t.auditLog).toHaveLength(0);
  });
  it("QA-M4-01: a valid reason is stored (trimmed) in the audit row of the view", async () => {
    seed();
    await getProofDetail(h.db, st(), staff("mod"), "pp", "  Verifying the order number  ");
    expect(h.t.auditLog!.at(-1)).toMatchObject({ action: "proof.view_redacted", metadata: { accessReason: "Verifying the order number" } });
  });
});

describe("REV-007 media per revision at approval", () => {
  it("REV-007: an asset that is not READY at approval is detached and never promoted; an added asset stays non-public until approval", async () => {
    const f = new FakeModerationDb();
    const r = f.addReview({ status: "PUBLISHED", currentVersion: 2, publishedVersion: 1, title: "Old" });
    f.revisions.length = 0;
    f.revisions.push({ reviewId: r.id, version: 1, status: "APPROVED" }, { reviewId: r.id, version: 2, status: "PENDING", rating: 4, title: "New", body: "New body of the review text.", incentive: "NONE" });
    const c = f.addCase(r.id as string, "AI_REVIEW", 2); c.trigger = "EDIT";
    const assets: Record<string, unknown>[] = [
      { id: "old", reviewId: r.id, status: "READY", bucket: "PRIVATE", attachedInVersion: 1, detachedInVersion: null },
      { id: "addedReady", reviewId: r.id, status: "READY", bucket: "PRIVATE", attachedInVersion: 2, detachedInVersion: null },
      { id: "addedBusy", reviewId: r.id, status: "PROCESSING", bucket: "PRIVATE", attachedInVersion: 2, detachedInVersion: null },
    ];
    const events: { type: string; payload: { assetId: string } }[] = [];
    Object.assign(f, {
      mediaAsset: {
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => { const hit = assets.filter((a) => matchRow(a, where)); hit.forEach((a) => Object.assign(a, data)); return { count: hit.length }; },
        findMany: async ({ where }: { where: Record<string, unknown> }) => assets.filter((a) => matchRow(a, where)).map((a) => ({ id: a.id as string })),
      },
      outboxEvent: { create: async ({ data }: { data: (typeof events)[number] }) => { events.push(data); return {}; } },
    });
    // Before approval: nothing is promoted and the staged assets are still in the private bucket.
    expect(events).toHaveLength(0);
    expect(assets.filter((a) => a.attachedInVersion === 2).every((a) => a.bucket === "PRIVATE")).toBe(true);
    await transitionCase(f as unknown as ModerationDb, { caseId: c.id, to: "APPROVED", actor: { type: "AI", provider: "t" } });
    expect(assets.find((a) => a.id === "addedBusy")!.detachedInVersion).toBe(2); // detached: it can never become public later
    expect(assets.find((a) => a.id === "addedReady")!.detachedInVersion).toBeNull();
    expect(events.filter((e) => e.type === "media.promote_requested").map((e) => e.payload.assetId).sort()).toEqual(["addedReady", "old"]);
  });
  it("REV-007: an edit that adds an asset leaves it staged (attachedInVersion set, still PRIVATE, no promote event)", async () => {
    h.t.mediaAsset!.push({ id: "m2", reviewId: "r1", ownerId: "author", status: "READY", bucket: "PRIVATE", attachedInVersion: null, detachedInVersion: null });
    await editOwnReview(h.db, "author", "r1", { expectedVersion: 1, addMediaIds: ["m2"] });
    expect(h.t.mediaAsset![0]).toMatchObject({ attachedInVersion: 2, bucket: "PRIVATE" });
    expect(h.t.outboxEvent!.some((e) => e.type === "media.promote_requested")).toBe(false);
  });
});

describe("SEL-013 incentive is re-validated on edit", () => {
  it("SEL-013: an unknown incentive is rejected by the route schema and by the service; a valid change goes to the revision, not the live row", async () => {
    expect(reviewEditInput.safeParse({ expectedVersion: 1, incentive: "BRIBE" }).success).toBe(false);
    expect(await code(editOwnReview(h.db, "author", "r1", { expectedVersion: 1, incentive: "BRIBE" as never }))).toBe("400:invalid_incentive");
    expect(h.t.reviewRevision!.find((x) => x.version === 2)).toBeUndefined();
    await editOwnReview(h.db, "author", "r1", { expectedVersion: 1, incentive: "FREE_PRODUCT" });
    expect(h.t.reviewRevision!.find((x) => x.version === 2)).toMatchObject({ incentive: "FREE_PRODUCT" });
    expect(h.t.review![0]!.incentive).toBe("NONE"); // live row unchanged until approval
  });
  it("SEL-013: an edit that does not mention the incentive carries the current one into the new revision", async () => {
    h.t.review![0]!.incentive = "DISCOUNT";
    await editOwnReview(h.db, "author", "r1", { expectedVersion: 1, title: "x" });
    expect(h.t.reviewRevision!.find((x) => x.version === 2)).toMatchObject({ incentive: "DISCOUNT" });
  });
});

describe("SEC-M4-02 vote race", () => {
  it("SEC-M4-02: concurrent identical switches apply the counter delta once; counters equal the vote rows", async () => {
    await putVote(h.db, "voter", "r1", "HELPFUL");
    await Promise.all([putVote(h.db, "voter", "r1", "NOT_HELPFUL"), putVote(h.db, "voter", "r1", "NOT_HELPFUL"), putVote(h.db, "voter", "r1", "NOT_HELPFUL")]);
    expect(h.t.review![0]).toMatchObject({ helpfulCount: 0, notHelpfulCount: 1 });
    expect(h.t.reviewVote).toHaveLength(1);
  });
  it("SEC-M4-02: concurrent first votes do not double count (the loser hits the primary key and is a no-op, not a 500)", async () => {
    const vote = (h.db as unknown as { reviewVote: { create: (a: { data: { reviewId: string; userId: string } }) => Promise<unknown> } }).reviewVote;
    const create = vote.create;
    vote.create = async (a) => { if (h.t.reviewVote!.some((v) => v.reviewId === a.data.reviewId && v.userId === a.data.userId)) throw Object.assign(new Error("unique"), { code: "P2002" }); return create(a); }; // PK (reviewId, userId)
    await Promise.all([putVote(h.db, "voter", "r1", "HELPFUL"), putVote(h.db, "voter", "r1", "HELPFUL")]);
    expect(h.t.review![0]).toMatchObject({ helpfulCount: 1, notHelpfulCount: 0 });
  });
});

describe("SEC-M4-03 staff revision history needs the 2FA gate", () => {
  it("SEC-M4-03: an admin without an enrolled and verified second factor gets 403 TWO_FACTOR_REQUIRED; the author is unaffected", async () => {
    for (const twoFactor of [undefined, { enrolled: true, verified: false }, { enrolled: false, verified: false }]) {
      expect(await code(listRevisions(h.db, { id: "mod", role: "admin", twoFactor } as Actor, "r1"))).toBe("403:TWO_FACTOR_REQUIRED");
    }
    expect(await listRevisions(h.db, staff("mod"), "r1")).toHaveLength(1);
    expect(await listRevisions(h.db, { id: "author", role: "user" } as Actor, "r1")).toHaveLength(1);
  });
});

describe("SEC-M4-04 rejectReport guards", () => {
  const open = async () => { await createReport(h.db, "voter", { reviewId: "r1" }, { reason: "SPAM" }, { now: NOW }); return h.t.report![0]!.id as string; };
  it("SEC-M4-04: the review's author and a member of the reviewed seller get 403 CONFLICT_OF_INTEREST and the report stays OPEN", async () => {
    const id = await open();
    h.t.sellerMember!.push({ sellerId: "S1", userId: "mod2" });
    expect(await code(rejectReport(h.db, staff("author"), id, NOW))).toBe("403:CONFLICT_OF_INTEREST");
    expect(await code(rejectReport(h.db, staff("mod2"), id, NOW))).toBe("403:CONFLICT_OF_INTEREST");
    expect(h.t.report![0]!.status).toBe("OPEN");
    expect(h.t.moderationCase![0]!.reportCount).toBe(1);
  });
  it("SEC-M4-04: a closed case is 409 invalid_transition; an open case decrements the counters once", async () => {
    const id = await open();
    h.t.moderationCase![0]!.state = "APPROVED";
    expect(await code(rejectReport(h.db, staff("mod"), id, NOW))).toBe("409:invalid_transition");
    h.t.moderationCase![0]!.state = "NEEDS_HUMAN";
    await rejectReport(h.db, staff("mod"), id, NOW);
    expect(h.t.report![0]!.status).toBe("REJECTED");
    expect(h.t.moderationCase![0]!.reportCount).toBe(0);
    expect(await code(rejectReport(h.db, staff("mod"), id, NOW))).toBe("409:invalid_transition");
  });
});
