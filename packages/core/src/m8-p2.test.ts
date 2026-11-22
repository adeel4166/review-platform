/** M8-01 P2s on the core side: SEC-M7-02 (per-recipient email cap, grouping key) and SEC-M7-03 (long windows, homoglyphs, NEW/LOW threshold). */
import { describe, expect, it } from "vitest";
import { dispatch, EMAIL_CAP, type NotificationEvent, type NotificationPorts } from "./notifications/dispatch";
import { BURST, detectProductBurst } from "./trust/burst";
import { minhash, estimateJaccard, nearDuplicateThreshold, shingles } from "./trust/minhash";

const at = new Date("2027-03-01T10:00:00Z");
function ports(recent = 0) {
  const jobs: string[] = []; const rows = new Set<string>();
  const p: NotificationPorts = {
    disabled: async () => new Set(),
    insertInApp: async (r) => { const k = `${r.recipientId}:${r.groupKey}`; if (rows.has(k)) return false; rows.add(k); return true; },
    enqueueEmail: async (id) => { if (!jobs.includes(id)) jobs.push(id); },
    recentEmails: async () => recent,
  };
  return { p, jobs };
}
const follow = (n: number): NotificationEvent => ({ eventId: `e${n}`, type: "NEW_FOLLOWER", recipientId: "victim", actorId: `sock${n}`, entityType: "User", entityId: `sock${n}`, at });

describe("SEC-M7-02 notification abuse", () => {
  it("20 sock-puppet follows yield one e-mail per recipient per day (grouping key excludes the actor)", async () => {
    const { p, jobs } = ports();
    for (let i = 0; i < 20; i++) await dispatch(p, follow(i));
    expect(jobs).toEqual(["notif__NEW_FOLLOWER__victim__2027-03-01"]);
  });
  it("the per-recipient hourly cap drops e-mail for non-mandatory types but keeps the in-app row", async () => {
    const { p, jobs } = ports(EMAIL_CAP.perHour);
    const r = await dispatch(p, { ...follow(1), type: "REVIEW_VOTED_HELPFUL" });
    expect(r).toMatchObject({ inApp: true, email: false });
    expect(jobs).toHaveLength(0);
  });
  it("mandatory types ignore the cap", async () => {
    const { p, jobs } = ports(1000);
    const r = await dispatch(p, { ...follow(1), type: "SECURITY_ALERT", entityId: "x" });
    expect(r.email).toBe(true); expect(jobs).toHaveLength(1);
  });
});

describe("SEC-M7-03 burst and near-duplicate evasion", () => {
  const rv = (i: number, band: "NEW" | "HIGH", minutesAgo: number) => ({ id: `r${i}`, createdAt: new Date(at.getTime() - minutesAgo * 60_000), authorBand: band });
  it("a slow drip under 10/h but over the 24 h threshold trips the burst", () => {
    const drip = Array.from({ length: 41 }, (_, i) => rv(i, "HIGH", 5 + i * 30)); // one every 30 min, never > 2/h
    expect(detectProductBurst(drip, at, null).burst).toBe(true);
    expect(detectProductBurst(drip.slice(0, 20), at, null).burst).toBe(false);
  });
  it("low-trust drip uses the lower 24 h threshold", () => {
    const drip = Array.from({ length: BURST.lowTrustPerProductPerDay + 1 }, (_, i) => rv(i, "NEW", 5 + i * 60));
    expect(detectProductBurst(drip, at, null).burst).toBe(true);
  });
  it("homoglyph and zero-width rewrites still match the original", () => {
    const a = "The battery of this phone is terrible and the screen cracked after a week of normal use";
    const b = "Thе bаttеry оf this phоne is terriblе and the scrеen crасked аfter a week оf nоrmal u​se"; // Cyrillic look-alikes + zero-width
    expect(estimateJaccard(minhash(a), minhash(b))).toBeGreaterThan(0.9);
    expect([...shingles(b)].join()).toBe([...shingles(a)].join());
  });
  it("NEW and LOW authors are matched at a lower threshold", () => {
    expect(nearDuplicateThreshold("NEW")).toBeLessThan(nearDuplicateThreshold("HIGH"));
    expect(nearDuplicateThreshold("LOW")).toBe(nearDuplicateThreshold("NEW"));
  });
});
