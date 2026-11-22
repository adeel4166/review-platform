import { describe, expect, it } from "vitest";
import { FakeObjectStore, createLedgerReader, createLedgerWriter } from "@rp/core";
import { FakeClock } from "@rp/core/testing";
import { makeFakeDb } from "../test-fake-db";
import { purgeProofFiles } from "../proofs";
import { replayDeletions } from "./replay-deletions";

const buckets = { ingest: "ingest", private: "private" };
function seed() {
  const h = makeFakeDb(["purchaseProof", "purchaseProofFile", "mediaAsset"]);
  const files = [{ id: "f1", proofId: "p1", isRedacted: false, storageKey: "proof/f1", status: "READY", purgedAt: null }, { id: "f2", proofId: "p1", isRedacted: true, storageKey: "proof/f2", status: "READY", purgedAt: null }];
  h.t.purchaseProofFile!.push(...files);
  h.t.purchaseProof!.push({ id: "p1", legalHold: false, filesPurgedAt: null, originalPurgedAt: null, files });
  return h;
}

describe("OPS-001 restore then re-delete: no resurrection", () => {
  it("purge a proof, restore the pre-purge DB, replay the ledger: every key 404 and filesPurgedAt set again", async () => {
    const store = new FakeObjectStore();
    const clock = new FakeClock("2027-03-01T00:00:00Z");
    for (const [b, k] of [["private", "proof/f1"], ["private", "proof/f2"], ["ingest", "in/proof/f1"], ["ingest", "in/proof/f2"]] as const) await store.put(b, k, Buffer.from("x"), "image/png");
    const ledger = createLedgerWriter(store, "ledger", clock, () => "seg-1");

    const before = seed(); // the backup taken before the purge
    const live = seed();
    expect(await purgeProofFiles({ db: live.db, store, buckets, now: () => clock.now(), ledger }, "p1", "ALL")).toBe("PURGED");
    expect(live.t.purchaseProof![0]!.filesPurgedAt).toBeInstanceOf(Date);
    clock.advance(86_400_000);

    // DB restore: rows are back with filesPurgedAt = NULL; a stale object also reappears (worst case: bucket copy restored).
    const restored = before;
    expect(restored.t.purchaseProof![0]!.filesPurgedAt).toBeNull();
    await store.put("private", "proof/f1", Buffer.from("stale"), "image/png");

    const r = await replayDeletions({ db: restored.db, store, reader: createLedgerReader(store, "ledger"), clock }, "2027-03-01");
    expect(r).toMatchObject({ failed: 0, replayed: 4 });
    for (const [b, k] of [["private", "proof/f1"], ["private", "proof/f2"], ["ingest", "in/proof/f1"], ["ingest", "in/proof/f2"]] as const) expect(await store.head(b, k)).toBeNull();
    expect(restored.t.purchaseProof![0]!.filesPurgedAt).toBeInstanceOf(Date);
    expect(restored.t.purchaseProof![0]!.originalPurgedAt).toBeInstanceOf(Date);
    expect(restored.t.purchaseProofFile!.every((f) => f.status === "PURGED")).toBe(true);
    // idempotent
    expect(await replayDeletions({ db: restored.db, store, reader: createLedgerReader(store, "ledger"), clock }, "2027-03-01")).toMatchObject({ failed: 0 });
  });
  it("reports a key whose deletion cannot be verified and leaves its row untouched", async () => {
    const store = new FakeObjectStore(); const clock = new FakeClock("2027-03-01T00:00:00Z");
    const ledger = createLedgerWriter(store, "ledger", clock, () => "s");
    await ledger.append([{ objectKey: "private/proof/f1", entity: "PurchaseProofFile", id: "f1", purgedAt: clock.now().toISOString() }]);
    await store.put("private", "proof/f1", Buffer.from("x"), "image/png");
    store.delete = async () => undefined; // storage refuses
    const h = seed();
    const r = await replayDeletions({ db: h.db, store, reader: createLedgerReader(store, "ledger"), clock }, "2027-03-01");
    expect(r.failed).toBe(1);
    expect(h.t.purchaseProofFile![0]!.status).toBe("READY");
  });
});
