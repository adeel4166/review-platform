import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { FakeModerationDb, FakeObjectStore, parseOrderRefKeys, type ModerationProvider } from "@rp/core";
import { processModeration, type WorkerDb } from "./moderation";
import { routes } from "./outbox";
import { assessProof, failClosedRedactor, finalizeProof, nullOldIpHashes, processProofFile, purgeProofFiles, reconcileVoteCounts, sweepProofs, type ProofDeps } from "./proofs";
import { makeFakeDb } from "./test-fake-db";

void FakeObjectStore;
const NOW = new Date("2026-12-10T12:00:00Z");

describe("OUT-008: every emitted outbox type has a route", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (f === "node_modules" ? [] : walk(join(d, f))) : f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("fake") ? [join(d, f)] : []));
  it("scans apps/web and apps/worker sources", () => {
    const roots = [join(__dirname, "../../web/src"), __dirname];
    const types = new Set<string>();
    for (const file of roots.flatMap(walk)) for (const m of readFileSync(file, "utf8").matchAll(/outboxEvent\.create\(\{ data: \{ type: (?:[^"`]*?\? )?"([a-z_.]+)"(?: : "([a-z_.]+)")?/g)) [m[1], m[2]].forEach((t) => t && types.add(t));
    expect(types.size).toBeGreaterThan(10);
    expect([...types].filter((t) => !(t in routes))).toEqual([]);
  });
});

describe("moderation revision path (MOD-019, REV-003)", () => {
  const prov: ModerationProvider = { name: "t", assess: vi.fn(async () => ({ score: 0, confidence: 1, reasons: ["r"] })) };
  const setup = () => {
    const f = new FakeModerationDb();
    const r = f.addReview({ status: "PUBLISHED", currentVersion: 2, publishedVersion: 1, title: "Old" });
    f.revisions.length = 0;
    f.revisions.push({ reviewId: r.id, version: 2, status: "PENDING", rating: 4, title: "New", body: "New body of the review text." });
    return { f, id: r.id as string };
  };
  const job = (id: string, version: number, trigger: "EDIT" | "SUBMISSION" = "EDIT") => ({ subjectType: "REVIEW" as const, subjectId: id, version, trigger });
  it("CLEAN edit publishes version 2 and creates an EDIT case", async () => {
    const { f, id } = setup();
    expect(await processModeration(f as unknown as WorkerDb, prov, job(id, 2))).toBe("APPROVED");
    expect(f.reviews[0]).toMatchObject({ status: "PUBLISHED", title: "New", publishedVersion: 2 });
    expect(f.cases[0]).toMatchObject({ trigger: "EDIT", version: 2 });
  });
  it("a late job for a superseded version is a no-op", async () => {
    const { f, id } = setup();
    f.reviews[0]!.currentVersion = 3;
    expect(await processModeration(f as unknown as WorkerDb, prov, job(id, 2))).toBe("SKIPPED");
    expect(f.cases).toHaveLength(0);
  });
  it("a SUBMISSION job for a PUBLISHED review and USER_REPORT jobs are ignored", async () => {
    const { f, id } = setup();
    expect(await processModeration(f as unknown as WorkerDb, prov, job(id, 2, "SUBMISSION"))).toBe("SKIPPED");
    expect(await processModeration(f as unknown as WorkerDb, prov, { ...job(id, 2), trigger: "USER_REPORT" } as never)).toBe("SKIPPED");
  });
  it("PRV-016: processModeration never sets the verified label", async () => {
    const { f, id } = setup();
    await processModeration(f as unknown as WorkerDb, prov, job(id, 2));
    expect(f.reviews[0]!.verifiedProofId ?? null).toBeNull();
  });
});

describe("proof pipeline", () => {
  const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: "#fff" } }).png().toBuffer();
  const mk = () => {
    const h = makeFakeDb(["review", "user", "purchaseProof", "purchaseProofFile", "outboxEvent", "trustSignal", "reviewVote", "report"], {
      purchaseProof: (r, t) => ({ files: t.purchaseProofFile!.filter((f) => f.proofId === r.id), review: { createdAt: new Date("2026-11-01"), product: { name: "W" } } }),
      purchaseProofFile: (r, t) => ({ proof: { submittedById: t.purchaseProof!.find((p) => p.id === r.proofId)?.submittedById } }),
    });
    const store = new FakeObjectStore();
    const deps: ProofDeps = { db: h.db, store: store as never, buckets: { ingest: "ingest", private: "private" }, redactor: failClosedRedactor, keys: parseOrderRefKeys("1:c2VjcmV0"), now: () => NOW };
    h.t.purchaseProof!.push({ id: "pp", reviewId: "r1", submittedById: "u1", status: "PENDING", openKey: "r1", slaDueAt: new Date("2026-12-12"), legalHold: false });
    return { h, store, deps };
  };
  const upload = async (s: ReturnType<typeof mk>, id: string, bytes: Buffer, mime = "image/png") => {
    s.h.t.purchaseProofFile!.push({ id, proofId: "pp", ownerId: "u1", kind: "IMAGE", status: "PROCESSING", declaredMime: mime, sizeBytes: bytes.length, storageKey: `in/proof/${id}`, isRedacted: false });
    await s.store.put("ingest", `in/proof/${id}`, bytes);
  };

  it("PRV-005/023: fail-closed redaction stores a fully masked derivative, then the proof is ready for staff exactly once", async () => {
    const s = mk(); await upload(s, "f1", await png());
    expect(await processProofFile(s.deps, "f1")).toBe("READY");
    const red = s.h.t.purchaseProofFile!.find((f) => f.isRedacted)!;
    expect(red).toMatchObject({ derivedFromId: "f1", status: "READY", detectedMime: "image/png" });
    const px = await sharp(await s.store.get("private", red.storageKey, 1e6) as Buffer).raw().toBuffer();
    expect(Math.max(...px)).toBe(0); // all black: nothing readable survives
    expect(s.h.t.purchaseProof![0]).toMatchObject({ redactionMode: "FULL_MASK", filesReadyAt: NOW });
    expect(s.h.t.purchaseProof![0]!.flags).toEqual(expect.arrayContaining(["REDACTION_FULL_MASK", "REDACTION_UNREADABLE"]));
    expect(s.h.t.outboxEvent!.filter((e) => e.type === "proof.files_ready")).toHaveLength(1);
    expect(await processProofFile(s.deps, "f1")).toBe("SKIPPED"); // idempotent (OUT-004)
    await finalizeProof(s.deps.db, "pp", NOW);
    expect(s.h.t.outboxEvent!.filter((e) => e.type === "proof.files_ready")).toHaveLength(1);
  });
  it("PRV-019: every file rejected -> EXPIRED(NO_VALID_FILES), not REJECTED", async () => {
    const s = mk(); await upload(s, "f1", Buffer.from("not an image at all"));
    expect(await processProofFile(s.deps, "f1")).toBe("REJECTED");
    expect(s.h.t.purchaseProof![0]).toMatchObject({ status: "EXPIRED", closeReason: "NO_VALID_FILES", openKey: null });
    expect(s.h.t.outboxEvent!.at(-1)).toMatchObject({ type: "proof.expired" });
  });
  it("declared type must match the bytes; a missing object is NOT_CONFIRMED; an unparseable PDF is CORRUPT (MED-046)", async () => {
    const s = mk(); await upload(s, "f1", await png(), "image/jpeg");
    expect(await processProofFile(s.deps, "f1")).toBe("REJECTED");
    expect(s.h.t.purchaseProofFile![0]!.failureReason).toBe("TYPE_MISMATCH");
    s.h.t.purchaseProofFile!.push({ id: "f2", proofId: "pp", ownerId: "u1", status: "PROCESSING", declaredMime: "image/png", storageKey: "in/proof/f2", isRedacted: false });
    expect(await processProofFile(s.deps, "f2")).toBe("REJECTED");
    expect(s.h.t.purchaseProofFile![1]!.failureReason).toBe("NOT_CONFIRMED");
    await upload(s, "f3", Buffer.from("%PDF-1.4 x"), "application/pdf");
    expect(await processProofFile(s.deps, "f3")).toBe("REJECTED");
    expect(s.h.t.purchaseProofFile!.find((f) => f.id === "f3")!.failureReason).toBe("CORRUPT");
  });
  it("PRV-020: no provider/budget -> hints skipped, flagged AI_SKIPPED, never decided; PRV-004: extractor sees redacted bytes only", async () => {
    const s = mk(); await upload(s, "f1", await png()); await processProofFile(s.deps, "f1");
    const a = { db: s.h.db, store: s.store as never, buckets: s.deps.buckets, keys: s.deps.keys, now: () => NOW };
    expect(await assessProof({ ...a, extractor: null, takeBudget: async () => true }, "pp")).toBe("SKIPPED_HINTS");
    expect(s.h.t.purchaseProof![0]).toMatchObject({ status: "PENDING", assessedAt: NOW });
    expect((s.h.t.purchaseProof![0]!.aiAssessment as { skipped: string }).skipped).toBe("BUDGET");
    expect(s.h.t.purchaseProof![0]!.flags).toContain("AI_SKIPPED");
    const s2 = mk(); await upload(s2, "f1", await png()); await processProofFile(s2.deps, "f1");
    const seen: Buffer[][] = [];
    const extractor = { extract: vi.fn(async ({ pages }: { pages: Buffer[] }) => { seen.push(pages); return { provider: "p", model: "m", promptVersion: "1", ocrText: "LEAK", merchant: { name: "Shop", confidence: 0.9 }, purchaseDate: { date: "2027-01-01", confidence: 0.9 }, flags: [] }; }) };
    expect(await assessProof({ db: s2.h.db, store: s2.store as never, buckets: s2.deps.buckets, keys: [], now: () => NOW, extractor, takeBudget: async () => true }, "pp")).toBe("ASSESSED");
    const orig = await s2.store.get("private", "proof/f1/orig", 1e6) as Buffer;
    expect(seen[0]!.every((p) => !p.equals(orig))).toBe(true);
    expect(JSON.stringify(s2.h.t.purchaseProof![0])).not.toContain("LEAK");
    expect(s2.h.t.purchaseProof![0]!.flags).toContain("DATE_IN_FUTURE");
    expect(s2.h.t.purchaseProof![0]!.status).toBe("PENDING");
  });
  it("PRV-025/008: same file on another account -> DUPLICATE_FILE + TrustSignal, not verified", async () => {
    const s = mk(); await upload(s, "f1", await png()); await processProofFile(s.deps, "f1");
    const sha = s.h.t.purchaseProofFile!.find((f) => f.id === "f1")!.sha256;
    s.h.t.purchaseProof!.push({ id: "other", reviewId: "r9", submittedById: "u2", status: "VERIFIED" });
    s.h.t.purchaseProofFile!.push({ id: "of", proofId: "other", sha256: sha, isRedacted: false, status: "PURGED" });
    await assessProof({ db: s.h.db, store: s.store as never, buckets: s.deps.buckets, keys: [], now: () => NOW, extractor: null, takeBudget: async () => true }, "pp");
    expect(s.h.t.purchaseProof![0]!.flags).toContain("DUPLICATE_FILE");
    expect(s.h.t.trustSignal![0]).toMatchObject({ type: "DUPLICATE_PROOF_DETECTED", userId: "u1" });
    expect(s.h.t.purchaseProof![0]!.status).toBe("PENDING");
  });
  it("PRV-006/022: purge removes originals at decision, filesPurgedAt only after HEAD 404; legal hold blocks", async () => {
    const s = mk(); await upload(s, "f1", await png()); await processProofFile(s.deps, "f1");
    s.h.t.purchaseProof![0]!.legalHold = true;
    expect(await purgeProofFiles(s.deps, "pp", "PROOF_ORIGINAL")).toBe("HELD");
    expect(await s.store.head("private", "proof/f1/orig")).not.toBeNull();
    s.h.t.purchaseProof![0]!.legalHold = false;
    expect(await purgeProofFiles(s.deps, "pp", "PROOF_ORIGINAL")).toBe("PURGED");
    expect(await s.store.head("private", "proof/f1/orig")).toBeNull();
    expect(await s.store.head("private", "proof/f1/redacted.png")).not.toBeNull(); // redacted copy kept until +90 d
    expect(s.h.t.purchaseProof![0]!.filesPurgedAt ?? null).toBeNull();
    expect(await purgeProofFiles(s.deps, "pp", "ALL")).toBe("PURGED");
    expect(await s.store.head("private", "proof/f1/redacted.png")).toBeNull();
    expect(s.h.t.purchaseProof![0]!.filesPurgedAt).toEqual(NOW);
  });
  it("sweeps: abandoned drafts, SLA expiry (+ notice event), decided originals, retention of redacted copies", async () => {
    const s = mk(); await upload(s, "f1", await png()); await processProofFile(s.deps, "f1");
    s.h.t.purchaseProof!.push({ id: "draft", reviewId: "r2", status: "DRAFT", openKey: "r2", createdAt: new Date("2026-12-08"), legalHold: false });
    s.h.t.purchaseProof![0]!.slaDueAt = new Date("2026-12-09");
    const out = await sweepProofs({ ...s.deps });
    expect(out).toMatchObject({ draftsExpired: 1, slaExpired: 1 });
    expect(s.h.t.purchaseProof!.find((p) => p.id === "draft")).toMatchObject({ status: "EXPIRED", closeReason: "DRAFT_ABANDONED" });
    expect(s.h.t.purchaseProof![0]).toMatchObject({ status: "EXPIRED", closeReason: "SLA_EXPIRED" });
    expect(s.h.t.outboxEvent!.some((e) => e.type === "proof.expired")).toBe(true);
    expect(s.h.t.purchaseProof![0]!.filesPurgedAt).toEqual(NOW); // expired proofs: files purged within 24 h
    const d = mk(); await upload(d, "f1", await png()); await processProofFile(d.deps, "f1");
    Object.assign(d.h.t.purchaseProof![0]!, { status: "VERIFIED", reviewedAt: new Date("2026-12-01"), retainFilesUntil: new Date("2027-03-01") });
    await sweepProofs({ ...d.deps });
    expect(await d.store.head("private", "proof/f1/orig")).toBeNull();
    expect(await d.store.head("private", "proof/f1/redacted.png")).not.toBeNull();
    await sweepProofs({ ...d.deps, now: () => new Date("2027-03-02") });
    expect(await d.store.head("private", "proof/f1/redacted.png")).toBeNull();
  });
});

describe("vote maintenance", () => {
  it("VOT-007 reconcile fixes a corrupted counter and logs the drift", async () => {
    const h = makeFakeDb(["review", "reviewVote", "report"]);
    (h.db as any).reviewVote.groupBy = // eslint-disable-line @typescript-eslint/no-explicit-any
     async () => [{ reviewId: "r1", value: "HELPFUL", _count: { _all: 2 } }, { reviewId: "r1", value: "NOT_HELPFUL", _count: { _all: 1 } }];
    h.t.review!.push({ id: "r1", helpfulCount: 9, notHelpfulCount: 0 }, { id: "r2", helpfulCount: 3, notHelpfulCount: 0 }, { id: "r3", helpfulCount: 0, notHelpfulCount: 0 });
    const log = vi.fn();
    expect(await reconcileVoteCounts(h.db, log)).toBe(2);
    expect(h.t.review!.map((r) => [r.helpfulCount, r.notHelpfulCount])).toEqual([[2, 1], [0, 0], [0, 0]]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ msg: "vote_counts.drift", reviewId: "r1" }));
  });
  it("VOT-006 ipHash is nulled after 90 days", async () => {
    const h = makeFakeDb(["reviewVote", "report"]);
    h.t.reviewVote!.push({ reviewId: "a", userId: "u", ipHash: "x", createdAt: new Date("2026-01-01") }, { reviewId: "b", userId: "u", ipHash: "y", createdAt: new Date("2026-12-01") });
    expect(await nullOldIpHashes(h.db, NOW)).toBe(1);
    expect(h.t.reviewVote!.map((v) => v.ipHash)).toEqual([null, "y"]);
  });
});
