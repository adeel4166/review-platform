import { describe, expect, it, vi } from "vitest";
import { FakeMailProvider, hashEmailToken } from "@rp/core";
import { sendAccountExistsEmail, sendVerificationEmail, type EmailDb } from "./email";

const NOW = new Date("2026-11-21T12:00:00Z");
function mk(row: Record<string, unknown> | null = {}) {
  const stored: { hash?: string } = {};
  const db = {
    emailVerificationToken: {
      findUnique: vi.fn(async () => row && { id: "t1", email: "a@x.io", purpose: "ACCOUNT_EMAIL", sentAt: null, consumedAt: null, invalidatedAt: null, expiresAt: new Date(NOW.getTime() + 1000), ...row }),
      updateMany: vi.fn(async (a: { data: { tokenHash?: string } }) => { if (a.data.tokenHash) stored.hash = a.data.tokenHash; return { count: 1 }; }),
    },
    user: { findUnique: vi.fn(async () => ({ id: "u1", email: "a@x.io", emailVerifiedAt: null })), updateMany: vi.fn(async () => ({ count: 1 })) },
  } as unknown as EmailDb;
  return { db, stored, mail: new FakeMailProvider() };
}

describe("worker email jobs", () => {
  it("mails a link whose token hashes to the stored digest; the raw token is never stored", async () => {
    const { db, stored, mail } = mk();
    expect(await sendVerificationEmail({ db, mail, baseUrl: "https://app.test", now: () => NOW }, "t1", "j1")).toBe("SENT");
    const token = new URL(mail.sent[0]!.text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!;
    expect(hashEmailToken(token)).toBe(stored.hash);
    expect(stored.hash).not.toContain(token);
    expect(mail.sent[0]!.text).toContain("https://app.test/verify-email?token=");
  });
  it("skips consumed, invalidated, expired or missing tokens", async () => {
    for (const row of [null, { consumedAt: NOW }, { invalidatedAt: NOW }, { expiresAt: new Date(NOW.getTime() - 1) }]) {
      const { db, mail } = mk(row);
      expect(await sendVerificationEmail({ db, mail, baseUrl: "https://app.test", now: () => NOW }, "t1", "j")).toBe("SKIPPED");
      expect(mail.sent).toHaveLength(0);
    }
  });
  it("account-exists mail has no token and is throttled to one per hour", async () => {
    const { db, mail } = mk();
    expect(await sendAccountExistsEmail({ db, mail, baseUrl: "https://app.test", now: () => NOW }, "u1", "j1")).toBe("SENT");
    expect(mail.sent[0]!.text).not.toContain("token=");
    (db.user.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    expect(await sendAccountExistsEmail({ db, mail, baseUrl: "https://app.test", now: () => NOW }, "u1", "j2")).toBe("SKIPPED");
    expect(mail.sent).toHaveLength(1);
  });
});
