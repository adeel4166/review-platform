import { describe, expect, it } from "vitest";
import { FakeMailProvider, buildMessage, hashEmailToken } from "@rp/core";
import { REMINDER_LEAD_MS, reminderDelayMs, sendTransferCancelLinks, type TransferNotifyDb } from "./ownership-transfer-email";

const T0 = new Date("2026-12-01T00:00:00Z");
const EXEC = new Date(T0.getTime() + 72 * 3_600_000);

function world(status = "PENDING") {
  const tokens = [
    { id: "t1", transferId: "x1", recipientId: "a", tokenHash: null as string | null, sentAt: null as Date | null, usedAt: null as Date | null },
    { id: "t2", transferId: "x1", recipientId: "b", tokenHash: null as string | null, sentAt: null as Date | null, usedAt: null as Date | null },
  ];
  const users = [
    { id: "a", email: "a@x.io", handle: "alice", status: "ACTIVE", emailVerifiedAt: T0 },
    { id: "b", email: "b@x.io", handle: "bob", status: "ACTIVE", emailVerifiedAt: T0 },
  ];
  const transfer = { id: "x1", kind: "TRANSFER", status, initiatorId: "a", targetUserId: "b", executeAfter: EXEC, seller: { slug: "acme" } };
  const db: TransferNotifyDb = {
    sellerOwnershipTransfer: { findUnique: async () => transfer },
    sellerTransferCancelToken: {
      findMany: async () => tokens.filter((t) => !t.usedAt).map((t) => ({ ...t })),
      updateMany: async ({ where, data }: { where: { id: string; usedAt?: null }; data: Record<string, unknown> }) => {
        const r = tokens.find((t) => t.id === where.id && (where.usedAt === undefined || !t.usedAt));
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
    },
    user: { findMany: async () => users },
  };
  return { db, tokens, transfer, mail: new FakeMailProvider() };
}
const linkOf = (text: string) => text.match(/https:\/\/\S+\/ownership-transfers\/cancel\?token=\S+/)![0];
const rawOf = (text: string) => new URL(linkOf(text)).searchParams.get("token")!;

describe("SEL-023 transfer cancel links (worker consumer of seller.ownership_transfer_requested)", () => {
  it("mints one token per recipient, stores only the SHA-256, uses the cancel-page link and sends Auto-Submitted mail", async () => {
    const w = world();
    const r = await sendTransferCancelLinks({ db: w.db, mail: w.mail, baseUrl: "https://app.test", now: () => T0 }, "x1", "REQUESTED", "otx1");
    expect(r).toEqual({ outcome: "SENT", executeAfter: EXEC });
    expect(w.mail.sent.map((m) => m.to).sort()).toEqual(["a@x.io", "b@x.io"]);
    const raws = w.mail.sent.map((m) => rawOf(m.text));
    expect(new Set(raws).size).toBe(2);
    for (const m of w.mail.sent) {
      expect(linkOf(m.text)).toMatch(/^https:\/\/app\.test\/ownership-transfers\/cancel\?token=[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
      expect(buildMessage("f@x.io", m, "k").headers).toMatchObject({ "Auto-Submitted": "auto-generated" });
      expect(m.text).toContain("@alice");
      expect(m.text).toContain(EXEC.toISOString());
    }
    expect(w.tokens.map((t) => t.tokenHash).sort()).toEqual(raws.map(hashEmailToken).sort());
    expect(JSON.stringify(w.tokens)).not.toContain(raws[0]!); // the raw token is never stored
    expect(w.tokens.every((t) => t.sentAt)).toBe(true);
  });

  it("a retried REQUESTED job does not re-mail or rotate already mailed tokens", async () => {
    const w = world();
    const d = { db: w.db, mail: w.mail, baseUrl: "https://app.test", now: () => T0 };
    await sendTransferCancelLinks(d, "x1", "REQUESTED", "otx1");
    const hashes = w.tokens.map((t) => t.tokenHash);
    expect((await sendTransferCancelLinks(d, "x1", "REQUESTED", "otx1")).outcome).toBe("SKIPPED");
    expect(w.mail.sent).toHaveLength(2);
    expect(w.tokens.map((t) => t.tokenHash)).toEqual(hashes);
  });

  it("SEL-024: the T-24h reminder issues a fresh link and the earlier link stops matching any stored hash", async () => {
    const w = world();
    const d = { db: w.db, mail: w.mail, baseUrl: "https://app.test", now: () => T0 };
    await sendTransferCancelLinks(d, "x1", "REQUESTED", "otx1");
    const first = w.mail.sent.map((m) => rawOf(m.text));
    await sendTransferCancelLinks({ ...d, now: () => new Date(EXEC.getTime() - REMINDER_LEAD_MS) }, "x1", "REMINDER", "otx2");
    const second = w.mail.sent.slice(2).map((m) => rawOf(m.text));
    expect(second).toHaveLength(2);
    expect(w.mail.sent[2]!.subject).toMatch(/Reminder/);
    const stored = new Set(w.tokens.map((t) => t.tokenHash));
    for (const raw of first) expect(stored.has(hashEmailToken(raw))).toBe(false); // old link invalidated
    for (const raw of second) expect(stored.has(hashEmailToken(raw))).toBe(true);
  });

  it("a reminder skips used tokens and ended transfers", async () => {
    const w = world();
    w.tokens[0]!.usedAt = T0;
    w.tokens[0]!.tokenHash = "h";
    const d = { db: w.db, mail: w.mail, now: () => T0 };
    await sendTransferCancelLinks(d, "x1", "REMINDER", "k");
    expect(w.mail.sent.map((m) => m.to)).toEqual(["b@x.io"]);
    for (const status of ["CANCELLED", "COMPLETED", "EXPIRED", "FAILED"]) {
      const e = world(status);
      expect((await sendTransferCancelLinks({ db: e.db, mail: e.mail, now: () => T0 }, "x1", "REMINDER", "k")).outcome).toBe("SKIPPED");
      expect(e.mail.sent).toHaveLength(0);
    }
  });

  it("schedules the reminder exactly 24 h before executeAfter, and not at all once that moment has passed", () => {
    expect(reminderDelayMs(EXEC, T0)).toBe(48 * 3_600_000);
    expect(reminderDelayMs(EXEC, new Date(EXEC.getTime() - REMINDER_LEAD_MS))).toBeNull();
    expect(reminderDelayMs(EXEC, EXEC)).toBeNull();
  });
});
