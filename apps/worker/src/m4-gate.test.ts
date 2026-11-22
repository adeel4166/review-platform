import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { FakeObjectStore, parseOrderRefKeys } from "@rp/core";
import { processProofFile, type ProofDeps, type Redactor } from "./proofs";
import { makeFakeDb } from "./test-fake-db";

// M4 gate (task #71): PRV-001 PII canary and PRV-005 fail-closed with a fake OCR adapter.
const NOW = new Date("2026-12-10T12:00:00Z");
const CANARY_ORDER = "ORDER-CANARY-9981-XYZ";
const CANARY_NAME = "CANARY NAME Jane Q Doe";
const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: "#fff" } }).png().toBuffer();

function mk(redactor: Redactor) {
  const h = makeFakeDb(["review", "user", "purchaseProof", "purchaseProofFile", "outboxEvent", "trustSignal", "reviewVote", "report"], {
    purchaseProof: (r, t) => ({ files: t.purchaseProofFile!.filter((f) => f.proofId === r.id), review: { createdAt: new Date("2026-11-01"), product: { name: "W" } } }),
    purchaseProofFile: (r, t) => ({ proof: { submittedById: t.purchaseProof!.find((p) => p.id === r.proofId)?.submittedById } }),
  });
  const store = new FakeObjectStore();
  const deps: ProofDeps = { db: h.db, store: store as never, buckets: { ingest: "ingest", private: "private" }, redactor, keys: parseOrderRefKeys("1:c2VjcmV0"), now: () => NOW };
  h.t.purchaseProof!.push({ id: "pp", reviewId: "r1", submittedById: "u1", status: "PENDING", openKey: "r1", slaDueAt: new Date("2026-12-12"), legalHold: false });
  return { h, store, deps };
}
const upload = async (s: ReturnType<typeof mk>) => {
  s.h.t.purchaseProofFile!.push({ id: "f1", proofId: "pp", ownerId: "u1", kind: "IMAGE", status: "PROCESSING", declaredMime: "image/png", sizeBytes: 1, storageKey: "in/proof/f1", isRedacted: false });
  const b = await png();
  s.h.t.purchaseProofFile![0]!.sizeBytes = b.length;
  await s.store.put("ingest", "in/proof/f1", b);
};

describe("PRV-001 PII canary", () => {
  it("an OCR adapter that sees an order number and a name: neither the raw order number nor the name is persisted, logged or queued", async () => {
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => { const o = console[m]; console[m] = (...a: unknown[]) => { logs.push(JSON.stringify(a)); }; return () => { console[m] = o; }; });
    try {
      const redactor: Redactor = {
        async redact() { return { png: await png(), mode: "AUTO", flags: [], orderRef: CANARY_ORDER, merchantSlug: "shop", ...({ ocrText: CANARY_NAME, boxes: [[1, 2, 3, 4]] } as object) }; },
      };
      const s = mk(redactor); await upload(s);
      expect(await processProofFile(s.deps, "f1")).toBe("READY");
      const dump = JSON.stringify([s.h.t.purchaseProof, s.h.t.purchaseProofFile, s.h.t.outboxEvent, s.h.t.trustSignal, logs]);
      expect(dump).not.toContain(CANARY_ORDER);
      expect(dump).not.toContain(CANARY_NAME);
      expect(dump).not.toContain("ocrText");
      expect(s.h.t.purchaseProof![0]!.orderRefHash ?? s.h.t.purchaseProof![0]!.orderHash ?? "present").not.toBe(CANARY_ORDER);
    } finally { spies.forEach((r) => r()); }
  });
});

describe("PRV-005 fail closed", () => {
  it("a redactor that throws never yields a READY derivative or a public/staff-visible original", async () => {
    const s = mk({ async redact() { throw new Error("ocr crashed"); } }); await upload(s);
    const r = await processProofFile(s.deps, "f1").catch(() => "THROWN");
    expect(["FAILED", "REJECTED", "THROWN"]).toContain(r);
    expect(s.h.t.purchaseProofFile!.some((f) => f.isRedacted && f.status === "READY")).toBe(false);
    expect(s.h.t.purchaseProof![0]!.filesReadyAt ?? null).toBeNull();
  });
});
