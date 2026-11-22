import { describe, expect, it } from "vitest";
import { FakeObjectStore, createLedgerReader, createLedgerWriter } from "@rp/core";
import { FakeClock } from "@rp/core/testing";
import { makeFakeDb } from "../test-fake-db";
import { eraseAccount, publicAuthor, requestErasure, soleOwnerBlock } from "./erase";

const buckets = { ingest: "ingest", private: "private", public: "public" };
const NAMES = ["user", "userSession", "twoFactorTotp", "recoveryCode", "erasureRequest", "outboxEvent", "appeal", "moderationCase", "purchaseProof", "purchaseProofFile", "mediaAsset", "follow", "userBlock", "notification", "notificationPreference", "reviewVote", "report", "review", "sellerMember"];

async function world(legalHold = false) {
  const h = makeFakeDb(NAMES);
  const store = new FakeObjectStore();
  const t = h.t;
  t.user!.push({ id: "u1", handle: "alice", displayName: "Alice A", email: "alice@example.com", bio: "hi", locale: "en", timeZone: "UTC", passwordHash: "x", status: "ACTIVE" });
  t.userSession!.push({ id: "s1", userId: "u1", revokedAt: null, ipHash: "a".repeat(64) });
  t.twoFactorTotp!.push({ id: "t1", userId: "u1" }); t.recoveryCode!.push({ id: "rc1", userId: "u1" });
  t.review!.push({ id: "r1", authorId: "u1", status: "PUBLISHED", verifiedAt: new Date() });
  t.moderationCase!.push({ id: "c1", review: { authorId: "u1" }, status: "OPEN", legalHold: false, openKey: "k" });
  t.appeal!.push({ id: "a1", appellantId: "u1", status: "SUBMITTED" });
  const files = [{ id: "f1", proofId: "p1", isRedacted: false, storageKey: "proof/f1", status: "READY" }, { id: "f2", proofId: "p1", isRedacted: true, storageKey: "proof/f2", status: "READY" }];
  t.purchaseProofFile!.push(...files);
  t.purchaseProof!.push({ id: "p1", submittedById: "u1", status: "VERIFIED", legalHold, filesPurgedAt: null, merchantName: "Shop", purchaseDate: new Date(), decisionNote: "ok", files });
  await store.put("private", "proof/f1", Buffer.from("orig"), "image/png"); await store.put("private", "proof/f2", Buffer.from("red"), "image/png"); await store.put("ingest", "in/proof/f1", Buffer.from("o"), "image/png");
  t.mediaAsset!.push({ id: "m1", ownerId: "u1", ingestKey: "in/m1", thumbKey: "pub/m1.webp", mediumKey: null, status: "READY" });
  await store.put("ingest", "in/m1", Buffer.from("m"), "image/png"); await store.put("public", "pub/m1.webp", Buffer.from("m"), "image/webp"); await store.put("private", "pub/m1.webp", Buffer.from("m"), "image/webp");
  t.follow!.push({ id: "f", followerId: "u1", followedUserId: "u2" }, { id: "f2", followerId: "u3", followedUserId: "u1" }, { id: "f3", followerId: "u3", followedUserId: "u4" });
  t.userBlock!.push({ id: "b", blockerId: "u1", blockedId: "u9" });
  t.notification!.push({ id: "n", recipientId: "u1" }); t.notificationPreference!.push({ id: "np", userId: "u1" });
  t.reviewVote!.push({ id: "v", userId: "u1", ipHash: "b".repeat(64) }); t.report!.push({ id: "rp", reporterId: "u1", ipHash: "c".repeat(64) });
  const clock = new FakeClock("2027-03-01T00:00:00Z");
  let seg = 0; const ledger = createLedgerWriter(store, "ledger", clock, () => `seg${++seg}`);
  return { ...h, store, clock, ledger, deps: { db: h.db, store, buckets, clock, ledger, random: () => "abc123" } };
}

describe("PRV-012 account erasure", () => {
  it("anonymises reviews, purges proofs and media (verified 404), removes social data, completes the request", async () => {
    const w = await world();
    const { erasureRequestId } = await requestErasure(w.deps, "u1");
    expect(w.t.user![0]!.status).toBe("DELETED");
    expect(await eraseAccount(w.deps, erasureRequestId)).toBe("DONE");
    const u = w.t.user![0]!;
    expect(u).toMatchObject({ handle: "former-abc123", displayName: "Former user", bio: null, passwordHash: null, status: "DELETED" });
    expect(u.email).not.toContain("alice");
    expect(publicAuthor(u as never)).toEqual({ name: "Former user", handle: null });
    expect(w.t.review).toHaveLength(1); // review kept, author unlinked in the DTO
    for (const [b, k] of [["private", "proof/f1"], ["private", "proof/f2"], ["ingest", "in/proof/f1"], ["ingest", "in/m1"], ["public", "pub/m1.webp"], ["private", "pub/m1.webp"]] as const) expect(await w.store.head(b, k), `${b}/${k}`).toBeNull(); // verified 404
    expect(w.t.purchaseProof![0]).toMatchObject({ merchantName: null, purchaseDate: null, decisionNote: null });
    expect(w.t.purchaseProof![0]!.filesPurgedAt).toBeInstanceOf(Date);
    expect(w.t.mediaAsset![0]).toMatchObject({ status: "FAILED", failureReason: "ERASED" });
    expect(w.t.follow!.map((f) => f.id)).toEqual(["f3"]);
    expect(w.t.userBlock).toHaveLength(0); expect(w.t.notification).toHaveLength(0); expect(w.t.twoFactorTotp).toHaveLength(0);
    expect(w.t.reviewVote![0]!.ipHash).toBeNull(); expect(w.t.report![0]!.ipHash).toBeNull(); expect(w.t.userSession![0]!.ipHash).toBeNull();
    expect(w.t.appeal![0]!.status).toBe("WITHDRAWN");
    expect(w.t.moderationCase![0]).toMatchObject({ status: "RESOLVED", resolutionCode: "WITHDRAWN_BY_AUTHOR" });
    const req = w.t.erasureRequest![0]!;
    expect(req.completedAt).toBeInstanceOf(Date);
    expect(Object.keys(req.steps as object).sort()).toEqual(["anonymise", "ipHash", "media", "notifications", "proofs", "sessions", "social"]);
    expect((await createLedgerReader(w.store, "ledger").read("2027-03-01")).length).toBe(7);
  });
  it("is idempotent and resumable: completed requests are a no-op", async () => {
    const w = await world();
    const { erasureRequestId } = await requestErasure(w.deps, "u1");
    await eraseAccount(w.deps, erasureRequestId);
    expect(await eraseAccount(w.deps, erasureRequestId)).toBe("NOOP");
    expect((await requestErasure(w.deps, "u1")).erasureRequestId).toBe(erasureRequestId);
  });
  it("does not complete while a purge cannot be verified (object still present), then finishes on retry", async () => {
    const w = await world();
    const realDelete = w.store.delete.bind(w.store); let fail = true;
    w.store.delete = async (b, k) => { if (fail && k === "proof/f1") return; await realDelete(b, k); };
    const { erasureRequestId } = await requestErasure(w.deps, "u1");
    expect(await eraseAccount(w.deps, erasureRequestId)).toBe("PARTIAL");
    expect(w.t.erasureRequest![0]!.completedAt).toBeUndefined();
    fail = false;
    expect(await eraseAccount(w.deps, erasureRequestId)).toBe("DONE");
  });
  it("legalHold proofs are not purged", async () => {
    const w = await world(true);
    const { erasureRequestId } = await requestErasure(w.deps, "u1");
    await eraseAccount(w.deps, erasureRequestId);
    expect(await w.store.head("private", "proof/f1")).not.toBeNull();
    expect(w.t.purchaseProof![0]!.merchantName).toBe("Shop");
  });
  it("sole OWNER of a seller with other members is blocked (409 last_owner)", async () => {
    const w = await world();
    w.t.sellerMember!.push({ id: "m1", sellerId: "s", userId: "u1", role: "OWNER" }, { id: "m2", sellerId: "s", userId: "u2", role: "MANAGER" });
    expect(await soleOwnerBlock(w.db, "u1")).toBe(true);
    w.t.sellerMember!.push({ id: "m3", sellerId: "s", userId: "u3", role: "OWNER" });
    expect(await soleOwnerBlock(w.db, "u1")).toBe(false);
  });
});
