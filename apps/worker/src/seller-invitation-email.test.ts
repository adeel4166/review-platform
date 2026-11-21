import { describe, expect, it, vi } from "vitest";
import { FakeMailProvider, hashEmailToken } from "@rp/core";
import { sendSellerInvitationEmail, type EmailDb } from "./email";

const NOW = new Date("2026-11-21T12:00:00Z");
function mk(row: Record<string, unknown> | null = {}) {
  const stored: { hash?: string; data?: unknown } = {};
  const db = {
    sellerInvitation: {
      findUnique: vi.fn(async () => row && { id: "i1", email: "b@x.io", sentAt: null, acceptedAt: null, revokedAt: null, expiresAt: new Date(NOW.getTime() + 1000), ...row }),
      updateMany: vi.fn(async (a: { data: { tokenHash?: string; expiresAt?: Date } }) => { if (a.data.tokenHash) { stored.hash = a.data.tokenHash; stored.data = a.data; } return { count: 1 }; }),
    },
  } as unknown as EmailDb;
  return { db, stored, mail: new FakeMailProvider() };
}

describe("sendSellerInvitationEmail", () => {
  it("mails a token whose SHA-256 is stored, and never extends the 7-day expiry", async () => {
    const { db, stored, mail } = mk();
    expect(await sendSellerInvitationEmail({ db, mail, baseUrl: "https://app.test", now: () => NOW }, "i1", "j1")).toBe("SENT");
    const token = new URL(mail.sent[0]!.text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!;
    expect(hashEmailToken(token)).toBe(stored.hash);
    expect(mail.sent[0]!.to).toBe("b@x.io");
    expect(Object.keys(stored.data as object)).toEqual(["tokenHash"]);
  });
  it("skips accepted, revoked, expired or missing invitations", async () => {
    for (const row of [null, { acceptedAt: NOW }, { revokedAt: NOW }, { expiresAt: new Date(NOW.getTime() - 1) }]) {
      const { db, mail } = mk(row);
      expect(await sendSellerInvitationEmail({ db, mail, now: () => NOW }, "i1", "j")).toBe("SKIPPED");
      expect(mail.sent).toHaveLength(0);
    }
  });
});
