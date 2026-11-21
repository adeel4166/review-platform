import { describe, expect, it, vi } from "vitest";
import { FakeModerationDb, transitionCase, SelfDecisionError, type ModerationDb, type ModerationProvider } from "@rp/core";
import { escalateDeadLetter, processModeration, type WorkerDb } from "./moderation";

const asDb = (f: FakeModerationDb) => f as unknown as WorkerDb;
const provider = (a: { score: number; confidence: number }): ModerationProvider => ({ name: "t", assess: vi.fn(async () => ({ ...a, reasons: ["r"] })) });
const clean = { score: 0.01, confidence: 0.95 };
const job = (id: string, version = 1) => ({ subjectType: "SELLER_REPLY" as const, subjectId: id, version });
/** Seller that already has 5 published replies, so the new-seller rule does not apply. */
const establishedSeller = (f: FakeModerationDb) => { for (let i = 0; i < 5; i++) f.addReply({ status: "PUBLISHED", publishedAt: new Date() }); };

describe("seller reply moderation (RPL-005)", () => {
  it("AI approve of a clean reply from an established seller publishes it", async () => {
    const f = new FakeModerationDb();
    establishedSeller(f);
    const r = f.addReply();
    expect(await processModeration(asDb(f), provider(clean), job(r.id as string))).toBe("APPROVED");
    expect(r.status).toBe("PUBLISHED");
    expect(r.publishedAt).toBeTruthy();
    expect(f.cases[0]).toMatchObject({ subjectType: "SELLER_REPLY", sellerReplyId: r.id, state: "APPROVED", version: 1 });
    expect(f.audit.map((a) => a.action)).toEqual(["seller_reply.ai_review_start", "seller_reply.approve"]);
    expect(f.audit.every((a) => a.entityType === "SellerReply")).toBe(true);
    expect(JSON.stringify(f.audit)).not.toContain("Thank you");
  });
  it("the seller's first replies always go to a human, even when the AI is sure", async () => {
    const f = new FakeModerationDb();
    const r = f.addReply();
    expect(await processModeration(asDb(f), provider(clean), job(r.id as string))).toBe("NEEDS_HUMAN");
    expect(r.status).toBe("HIDDEN");
    expect(f.cases[0]).toMatchObject({ state: "NEEDS_HUMAN", decisionReason: "reply_new_seller" });
  });
  it("a soft-flagged reply (phone, messenger) goes to a human even for an established seller", async () => {
    for (const text of ["Call +49 151 1234 5678", "Message us on WhatsApp please"]) {
      const f = new FakeModerationDb();
      establishedSeller(f);
      const r = f.addReply({ body: text });
      expect(await processModeration(asDb(f), provider(clean), job(r.id as string))).toBe("NEEDS_HUMAN");
      expect(r.status).toBe("HIDDEN");
      expect(f.cases[0]).toMatchObject({ decisionReason: "reply_soft_flag" });
    }
  });
  it("AI reject and AI unsure map to REJECTED / HIDDEN", async () => {
    const f = new FakeModerationDb();
    establishedSeller(f);
    const a = f.addReply(), b = f.addReply({ sellerId: "S1" });
    expect(await processModeration(asDb(f), provider({ score: 0.99, confidence: 0.95 }), job(a.id as string))).toBe("REJECTED");
    expect(a.status).toBe("REJECTED");
    expect(await processModeration(asDb(f), provider({ score: 0.01, confidence: 0.2 }), job(b.id as string))).toBe("NEEDS_HUMAN");
    expect(b.status).toBe("HIDDEN");
  });
  it("provider failure never approves: retry throws, dead-letter escalates to a human", async () => {
    const f = new FakeModerationDb();
    establishedSeller(f);
    const r = f.addReply();
    const bad: ModerationProvider = { name: "t", assess: vi.fn().mockRejectedValue(new Error("503")) };
    await expect(processModeration(asDb(f), bad, job(r.id as string))).rejects.toThrow("503");
    expect(r.status).toBe("PENDING");
    expect(await escalateDeadLetter(asDb(f), job(r.id as string), "503")).toBe(true);
    expect(r.status).toBe("HIDDEN");
    expect(f.cases[0]).toMatchObject({ state: "NEEDS_HUMAN", decisionReason: "ai_failure_dead_letter" });
  });
  it("stale, deleted or already-decided replies are skipped", async () => {
    const f = new FakeModerationDb();
    const edited = f.addReply({ version: 2 });
    expect(await processModeration(asDb(f), provider(clean), job(edited.id as string, 1))).toBe("SKIPPED"); // job for v1, reply is v2
    const deleted = f.addReply({ status: "DELETED" });
    expect(await processModeration(asDb(f), provider(clean), job(deleted.id as string))).toBe("SKIPPED");
    expect(await processModeration(asDb(f), provider(clean), job("missing"))).toBe("SKIPPED");
  });
  it("a human approve publishes a HIDDEN reply; a human decision on a stale version changes nothing", async () => {
    const f = new FakeModerationDb();
    const r = f.addReply({ status: "HIDDEN", version: 2 });
    const stale = f.addReplyCase(r.id as string, "NEEDS_HUMAN", 1);
    await expect(transitionCase(f as unknown as ModerationDb, { caseId: stale.id as string, to: "APPROVED", actor: { type: "STAFF", id: "mod1" } })).rejects.toThrow();
    expect(f.replies.find((x) => x.id === r.id)!.status).toBe("HIDDEN"); // not published (re-read: a rolled-back transaction restores rows)
    const cur = f.addReplyCase(r.id as string, "NEEDS_HUMAN", 2);
    await transitionCase(f as unknown as ModerationDb, { caseId: cur.id as string, to: "APPROVED", actor: { type: "STAFF", id: "mod1" } });
    expect(f.replies.find((x) => x.id === r.id)!.status).toBe("PUBLISHED");
    expect(f.audit.at(-1)).toMatchObject({ action: "seller_reply.approve", actorType: "STAFF", entityType: "SellerReply" });
  });
  it("staff cannot decide their own reply", async () => {
    const f = new FakeModerationDb();
    const r = f.addReply({ status: "HIDDEN", authorId: "mod1" });
    const c = f.addReplyCase(r.id as string, "NEEDS_HUMAN", 1);
    await expect(transitionCase(f as unknown as ModerationDb, { caseId: c.id as string, to: "APPROVED", actor: { type: "STAFF", id: "mod1" } })).rejects.toBeInstanceOf(SelfDecisionError);
  });
  it("a reply published only after approval: PENDING and HIDDEN are never public states", async () => {
    const f = new FakeModerationDb();
    const r = f.addReply();
    expect(r.status).toBe("PENDING");
    await processModeration(asDb(f), provider(clean), job(r.id as string));
    expect(r.status).not.toBe("PUBLISHED"); // new seller -> human first
  });
});
