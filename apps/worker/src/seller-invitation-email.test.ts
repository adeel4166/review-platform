import { describe, expect, it, vi } from "vitest";
import { FakeMailProvider, buildMessage, hashEmailToken } from "@rp/core";
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

import { sendClaimBusinessEmail, type ClaimEmailDeps } from "./email";
describe("sendClaimBusinessEmail", () => {
  const mkClaim = (claimStatus = "PENDING") => {
    const stored: { hash?: string } = {};
    const db = {
      emailVerificationToken: {
        findUnique: vi.fn(async () => ({ id: "t1", email: "me@brand.io", purpose: "CLAIM_BUSINESS_EMAIL", claimId: "c1", sentAt: null, consumedAt: null, invalidatedAt: null, expiresAt: new Date(NOW.getTime() + 1000) })),
        updateMany: vi.fn(async (a: { data: { tokenHash?: string } }) => { if (a.data.tokenHash) stored.hash = a.data.tokenHash; return { count: 1 }; }),
      },
      sellerOwnershipClaim: { findUnique: vi.fn(async () => ({ domain: "brand.io", status: claimStatus, seller: { slug: "brand" } })) },
    } as unknown as ClaimEmailDeps["db"];
    return { db, stored, mail: new FakeMailProvider() };
  };
  it("SEL-036: the claim token mail carries Auto-Submitted: auto-generated, stores only the hash, has no seller free text", async () => {
    const { db, stored, mail } = mkClaim();
    expect(await sendClaimBusinessEmail({ db, mail, baseUrl: "https://app.test", now: () => NOW }, "t1", "j1")).toBe("SENT");
    const m = mail.sent[0]!;
    expect(buildMessage("f@x.io", m, "k").headers["Auto-Submitted"]).toBe("auto-generated");
    expect(m.text).toContain("https://app.test/sellers/brand");
    const token = new URL(m.text.match(/https:\/\/app\.test\/claims\S+/)![0]).searchParams.get("token")!;
    expect(hashEmailToken(token)).toBe(stored.hash);
  });
  it("SEL-036: a claim that is no longer PENDING sends nothing", async () => {
    const { db, mail } = mkClaim("REJECTED");
    expect(await sendClaimBusinessEmail({ db, mail, now: () => NOW }, "t1", "j")).toBe("SKIPPED");
    expect(mail.sent).toHaveLength(0);
  });
});
