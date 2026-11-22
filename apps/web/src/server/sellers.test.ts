import { beforeEach, describe, expect, it } from "vitest";
import { SELLER_PERMISSIONS, findPiiAuditKeys, hashEmailToken, type SellerPermission } from "@rp/core";
import { acceptInvitation, createSeller, inviteMember, removeMember, requireSellerPermission, revokeInvitation, suspendSeller, unsuspendSeller } from "./sellers";
import { HttpError } from "./http";
import { invitationAcceptInput, invitationInput, sellerCreateInput } from "./validation";
import type { Actor } from "./session";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Tiny where-matcher: equality, null, {gt,lte,in,startsWith}, OR. Enough for the service queries. */
function match(r: Row, w: Row = {}): boolean {
  return Object.entries(w).every(([k, v]) => {
    if (k === "OR") return (v as Row[]).some((x) => match(r, x));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gt" in v) return r[k] != null && r[k] > v.gt;
      if ("lte" in v) return r[k] != null && r[k] <= v.lte;
      if ("in" in v) return v.in.includes(r[k]);
      if ("startsWith" in v) return typeof r[k] === "string" && r[k].startsWith(v.startsWith);
      if (k === "sellerId_userId") return r.sellerId === v.sellerId && r.userId === v.userId;
      return false;
    }
    return (r[k] ?? null) === v;
  });
}

const cp = (r: Row | undefined) => (r ? { ...r } : null); // reads return copies, like a real DB

function makeDb() {
  const t: Record<string, Row[]> = { user: [], seller: [], sellerMember: [], sellerInvitation: [], enforcementAction: [], sellerOwnershipClaim: [], sellerOwnershipTransfer: [], auditLog: [], outboxEvent: [] };
  let n = 0;
  const table = (name: string, defaults: () => Row = () => ({})) => ({
    findUnique: async ({ where }: Row) => cp(t[name]!.find((r) => match(r, where))),
    findFirst: async ({ where }: Row) => cp(t[name]!.find((r) => match(r, where))),
    findMany: async ({ where }: Row) => t[name]!.filter((r) => match(r, where)),
    count: async ({ where }: Row = {}) => t[name]!.filter((r) => match(r, where)).length,
    create: async ({ data }: Row) => {
      const { members, ...rest } = data;
      const row = { id: `${name}${++n}`, createdAt: new Date(), ...defaults(), ...rest };
      t[name]!.push(row);
      if (members) t.sellerMember!.push({ sellerId: row.id, ...members.create });
      return row;
    },
    update: async ({ where, data }: Row) => Object.assign(t[name]!.find((r) => match(r, where))!, data),
    updateMany: async ({ where, data }: Row) => {
      const rows = t[name]!.filter((r) => match(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    delete: async ({ where }: Row) => { t[name] = t[name]!.filter((r) => !match(r, where)); },
  });
  const db = {
    user: table("user"), seller: table("seller", () => ({ status: "UNVERIFIED", closedAt: null })), sellerMember: table("sellerMember"),
    sellerInvitation: table("sellerInvitation", () => ({ acceptedAt: null, revokedAt: null })),
    enforcementAction: table("enforcementAction", () => ({ status: "ACTIVE" })),
    sellerOwnershipClaim: table("sellerOwnershipClaim"), sellerOwnershipTransfer: table("sellerOwnershipTransfer"), auditLog: table("auditLog"), outboxEvent: table("outboxEvent"),
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  const addUser = (id: string, extra: Row = {}) => t.user!.push({ id, email: `${id.toLowerCase()}@x.io`, emailVerifiedAt: new Date("2026-01-01"), status: "ACTIVE", ...extra });
  return { db: db as never, t, addUser };
}

const NOW = new Date("2026-11-21T12:00:00Z");
const actor = (id: string, role: Actor["role"] = "user"): Actor => ({ id, role, twoFactor: { enrolled: true, verified: true } });
const token = "tok-" + "x".repeat(30);

let h: ReturnType<typeof makeDb>;
beforeEach(() => {
  h = makeDb();
  for (const u of ["ownerA", "managerA", "responderA", "ownerB", "outsider", "inv"]) h.addUser(u);
  h.t.seller!.push({ id: "A", status: "UNVERIFIED", closedAt: null }, { id: "B", status: "UNVERIFIED", closedAt: null });
  h.t.sellerMember!.push(
    { sellerId: "A", userId: "ownerA", role: "OWNER" }, { sellerId: "A", userId: "managerA", role: "MANAGER" }, { sellerId: "A", userId: "responderA", role: "RESPONDER" },
    { sellerId: "B", userId: "ownerB", role: "OWNER" },
  );
});

const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: HttpError) => `${e.status}:${e.code}`);

describe("cross-seller authz, table-driven over every permission (AZ-010, P-2)", () => {
  const members = [["ownerA", "OWNER"], ["managerA", "MANAGER"], ["responderA", "RESPONDER"]] as const;
  const allowed: Record<SellerPermission, string[]> = {
    "seller.profile.update": ["OWNER", "MANAGER"], "seller.member.invite": ["OWNER", "MANAGER"], "seller.member.manage": ["OWNER"],
    "seller.claim.submit": ["OWNER", "MANAGER"], "seller.claim.review": [], "product.update": ["OWNER", "MANAGER"], "product.image.manage": ["OWNER", "MANAGER"],
    "seller.reply": ["OWNER", "MANAGER", "RESPONDER"], "seller.reply.manage": ["OWNER", "MANAGER", "RESPONDER"],
  };
  beforeEach(() => { for (const s of h.t.seller!) s.status = "VERIFIED"; }); // reply permissions additionally need a VERIFIED seller
  for (const perm of SELLER_PERMISSIONS) {
    for (const [uid, role] of members) {
      it(`${perm}: ${role} of seller A is denied on seller B (404, no enumeration) and ${allowed[perm].includes(role) ? "allowed" : "denied"} on A`, async () => {
        const onB = await code(requireSellerPermission(h.db, actor(uid), perm, "B", NOW));
        expect(onB).toBe(perm === "seller.claim.review" ? "403:FORBIDDEN_ROLE" : "404:not_found");
        const onA = await code(requireSellerPermission(h.db, actor(uid), perm, "A", NOW));
        expect(onA === "ok").toBe(allowed[perm].includes(role));
      });
    }
    it(`${perm}: a non-member and a suspended seller's members (AZ-007)`, async () => {
      expect(await code(requireSellerPermission(h.db, actor("outsider"), perm, "A", NOW))).not.toBe("ok");
      h.t.enforcementAction!.push({ id: "e", subjectSellerId: "A", type: "SELLER_SUSPENSION", status: "ACTIVE", startsAt: new Date(NOW.getTime() - 1000), endsAt: null });
      for (const [uid] of members) expect(await code(requireSellerPermission(h.db, actor(uid), perm, "A", NOW))).not.toBe("ok");
      // Suspension of A does not affect B's members.
      expect(await code(requireSellerPermission(h.db, actor("ownerB"), "seller.member.manage", "B", NOW))).toBe("ok");
    });
  }
  it("an expired suspension no longer blocks", async () => {
    h.t.enforcementAction!.push({ id: "e", subjectSellerId: "A", type: "SELLER_SUSPENSION", status: "ACTIVE", startsAt: new Date(NOW.getTime() - 5000), endsAt: new Date(NOW.getTime() - 1000) });
    expect(await code(requireSellerPermission(h.db, actor("ownerA"), "seller.member.manage", "A", NOW))).toBe("ok");
  });
  it("a banned owner is denied", async () => {
    h.t.user!.find((u) => u.id === "ownerA")!.status = "BANNED";
    expect(await code(requireSellerPermission(h.db, actor("ownerA"), "seller.member.manage", "A", NOW))).toBe("403:ACCOUNT_INACTIVE");
  });
  it("client-supplied sellerId is rejected by the strict schemas", () => {
    expect(invitationInput.safeParse({ email: "a@b.io", role: "MANAGER", sellerId: "B" }).success).toBe(false);
    expect(sellerCreateInput.safeParse({ name: "Acme", sellerId: "B" }).success).toBe(false);
    expect(invitationInput.safeParse({ email: "a@b.io", role: "OWNER" }).success).toBe(false);
    expect(invitationAcceptInput.safeParse({ token, sellerId: "B" }).success).toBe(false);
  });
  it("revoke derives the seller from the invitation: an owner of B cannot revoke A's invitation", async () => {
    h.t.sellerInvitation!.push({ id: "i1", sellerId: "A", role: "RESPONDER", invitedById: "ownerA", email: "z@x.io", acceptedAt: null, revokedAt: null });
    expect(await code(revokeInvitation(h.db, actor("ownerB"), "i1", NOW))).toBe("404:not_found");
    expect(await code(revokeInvitation(h.db, actor("ownerA"), "i1", NOW))).toBe("ok");
    expect(await code(revokeInvitation(h.db, actor("ownerA"), "i1", NOW))).toBe("404:not_found");
  });
});

describe("invitations (SEL-007)", () => {
  const invite = async (by = "ownerA", email = "inv@x.io", role: "MANAGER" | "RESPONDER" = "MANAGER", sellerId = "A") =>
    inviteMember(h.db, actor(by), sellerId, { email, role }, NOW);
  /** Simulates the worker: stores the hash of a known raw token. */
  const send = (id: string, raw = token) => Object.assign(h.t.sellerInvitation!.find((i) => i.id === id)!, { tokenHash: hashEmailToken(raw), sentAt: NOW });

  it("expires after 7 days, queues the mail through the outbox and audits without PII", async () => {
    const inv = (await invite()) as { id: string; expiresAt: Date };
    expect(inv.expiresAt.getTime() - NOW.getTime()).toBe(7 * 86400_000);
    expect(h.t.outboxEvent).toEqual([expect.objectContaining({ type: "seller.invitation_created", payload: { invitationId: inv.id } })]);
    expect(JSON.stringify(h.t.outboxEvent)).not.toContain("inv@x.io");
    const logs = h.t.auditLog!;
    expect(logs.map((l) => l.action)).toEqual(["seller.invitation.created"]);
    for (const l of logs) { expect(findPiiAuditKeys(l.metadata)).toEqual([]); expect(JSON.stringify(l)).not.toContain("@"); }
  });
  it("MANAGER may invite only RESPONDER; RESPONDER cannot invite; OWNER is never grantable", async () => {
    expect(await code(invite("managerA", "q@x.io", "MANAGER"))).toBe("403:FORBIDDEN_ROLE");
    expect(await code(invite("managerA", "q@x.io", "RESPONDER"))).toBe("ok");
    expect(await code(invite("responderA", "q@x.io", "RESPONDER"))).toBe("403:FORBIDDEN_ROLE");
    expect(await code(invite("ownerB", "q@x.io", "RESPONDER", "A"))).toBe("404:not_found");
  });
  it("a newer invitation revokes the older open one for the same email", async () => {
    const a = (await invite()) as { id: string };
    await invite();
    expect(h.t.sellerInvitation!.find((i) => i.id === a.id)!.revokedAt).toEqual(NOW);
    expect(h.t.sellerInvitation!.filter((i) => !i.revokedAt)).toHaveLength(1);
  });
  it("caps invitations per day", async () => {
    for (let i = 0; i < 10; i++) await invite("ownerA", `p${i}@x.io`);
    expect(await code(invite("ownerA", "late@x.io"))).toBe("429:rate_limited");
  });
  it("accept: verified invitee joins once with the invited role; replay fails; audit has no PII", async () => {
    const inv = (await invite()) as { id: string };
    send(inv.id);
    expect(await acceptInvitation(h.db, actor("inv"), token, NOW)).toEqual({ sellerId: "A", role: "MANAGER" });
    expect(h.t.sellerMember!.find((m) => m.userId === "inv")).toMatchObject({ sellerId: "A", role: "MANAGER", invitationId: inv.id });
    expect(await code(acceptInvitation(h.db, actor("inv"), token, NOW))).toBe("400:invalid_or_expired");
    for (const l of h.t.auditLog!) expect(findPiiAuditKeys(l.metadata)).toEqual([]);
    expect(h.t.auditLog!.map((l) => l.action)).toEqual(expect.arrayContaining(["seller.invitation.accepted", "seller.member.added"]));
  });
  it("accept: another account, unverified email, expired and revoked all give the same 400", async () => {
    const inv = (await invite()) as { id: string };
    send(inv.id);
    expect(await code(acceptInvitation(h.db, actor("outsider"), token, NOW))).toBe("400:invalid_or_expired"); // bound to the invitee's email
    h.t.user!.find((u) => u.id === "inv")!.emailVerifiedAt = null;
    expect(await code(acceptInvitation(h.db, actor("inv"), token, NOW))).toBe("400:invalid_or_expired");
    h.t.user!.find((u) => u.id === "inv")!.emailVerifiedAt = new Date();
    expect(await code(acceptInvitation(h.db, actor("inv"), token, new Date(NOW.getTime() + 7 * 86400_000 + 1)))).toBe("400:invalid_or_expired");
    expect(await code(acceptInvitation(h.db, actor("inv"), "nope-" + "y".repeat(30), NOW))).toBe("400:invalid_or_expired");
    h.t.sellerInvitation!.find((i) => i.id === inv.id)!.revokedAt = NOW;
    expect(await code(acceptInvitation(h.db, actor("inv"), token, NOW))).toBe("400:invalid_or_expired");
    expect(h.t.sellerMember!.some((m) => m.userId === "inv")).toBe(false);
  });
  it("accept: an existing member gets 409 only after the token is proven valid", async () => {
    const inv = (await invite("ownerA", "managera@x.io", "RESPONDER")) as { id: string };
    send(inv.id);
    expect(await code(acceptInvitation(h.db, actor("managerA"), token, NOW))).toBe("409:already_member");
  });
});

describe("members: at least one OWNER at all times", () => {
  it("the last OWNER can neither be removed nor leave", async () => {
    expect(await code(removeMember(h.db, actor("ownerA"), "A", "ownerA", NOW))).toBe("409:last_owner");
    expect(h.t.sellerMember!.some((m) => m.userId === "ownerA")).toBe(true);
  });
  it("OWNER removes a member; the audit entry carries ids only", async () => {
    expect(await code(removeMember(h.db, actor("ownerA"), "A", "managerA", NOW))).toBe("ok");
    expect(h.t.sellerMember!.some((m) => m.userId === "managerA")).toBe(false);
    const l = h.t.auditLog!.find((x) => x.action === "seller.member.removed")!;
    expect(l.metadata).toEqual({ sellerId: "A", userId: "managerA", role: "MANAGER", leaving: false });
  });
  it("MANAGER and RESPONDER cannot remove others, but may leave; outsiders and other sellers' owners get 404", async () => {
    expect(await code(removeMember(h.db, actor("managerA"), "A", "responderA", NOW))).toBe("403:FORBIDDEN_ROLE");
    expect(await code(removeMember(h.db, actor("ownerB"), "A", "responderA", NOW))).toBe("404:not_found");
    expect(await code(removeMember(h.db, actor("outsider"), "A", "outsider", NOW))).toBe("404:not_found");
    expect(await code(removeMember(h.db, actor("responderA"), "A", "responderA", NOW))).toBe("ok");
  });
});

describe("createSeller (SEL-010) and suspension (AZ-007)", () => {
  it("creates the seller with its OWNER, audits ids only, and reports no badge", async () => {
    const s = (await createSeller(h.db, actor("outsider"), { name: "Acme Store" }, NOW)) as { id: string; status: string; nameReviewFlag: boolean };
    expect(s).toMatchObject({ status: "UNVERIFIED", nameReviewFlag: false });
    expect(h.t.sellerMember!.find((m) => m.sellerId === s.id)).toMatchObject({ userId: "outsider", role: "OWNER" });
    for (const l of h.t.auditLog!) expect(findPiiAuditKeys(l.metadata)).toEqual([]);
  });
  it("flags a name similar to a VERIFIED seller", async () => {
    h.t.seller!.push({ id: "V", status: "VERIFIED", nameSkeleton: "acmestore" });
    const s = (await createSeller(h.db, actor("outsider"), { name: "Acme Stor3" }, NOW)) as { nameReviewFlag: boolean };
    expect(s.nameReviewFlag).toBe(true);
    const t = (await createSeller(h.db, actor("outsider"), { name: "Globex Industries" }, NOW)) as { nameReviewFlag: boolean };
    expect(t.nameReviewFlag).toBe(false);
  });
  it("limits sellers per user per day", async () => {
    for (const n of ["One Co", "Two Co", "Three Co"]) await createSeller(h.db, actor("outsider"), { name: n }, NOW);
    expect(await code(createSeller(h.db, actor("outsider"), { name: "Four Co" }, NOW))).toBe("429:rate_limited");
  });
  it("suspend blocks every member, unsuspend restores, both are audited as STAFF; only admins may", async () => {
    expect(await code(suspendSeller(h.db, actor("ownerA"), "A", { reasonCode: "POLICY_X", publicReason: "violation" }, NOW))).toBe("403:forbidden");
    const r = (await suspendSeller(h.db, actor("adm", "admin"), "A", { reasonCode: "POLICY_X", publicReason: "violation" }, NOW)) as { status: string };
    expect(r.status).toBe("SUSPENDED");
    expect(await code(requireSellerPermission(h.db, actor("ownerA"), "seller.member.invite", "A", NOW))).toBe("403:SELLER_SUSPENDED");
    expect(await code(inviteMember(h.db, actor("ownerA"), "A", { email: "z@x.io", role: "MANAGER" }, NOW))).toBe("403:SELLER_SUSPENDED");
    expect(await code(unsuspendSeller(h.db, actor("adm", "admin"), "A", NOW))).toBe("403:second_actor_required"); // T-04
    expect(((await unsuspendSeller(h.db, actor("adm2", "admin"), "A", NOW)) as { status: string }).status).toBe("UNVERIFIED");
    expect(await code(requireSellerPermission(h.db, actor("ownerA"), "seller.member.invite", "A", NOW))).toBe("ok");
    expect(h.t.auditLog!.filter((l) => l.actorType === "STAFF").map((l) => l.action)).toEqual(
      expect.arrayContaining(["enforcement.issued", "seller.status_changed", "enforcement.revoked"]),
    );
  });
  it("T-04: a staff actor who is a member of the seller cannot suspend or unsuspend it (CONFLICT_OF_INTEREST)", async () => {
    h.t.sellerMember!.push({ sellerId: "A", userId: "staffMember", role: "RESPONDER" });
    const staffMember = actor("staffMember", "admin");
    expect(await code(suspendSeller(h.db, staffMember, "A", { reasonCode: "POLICY_X", publicReason: "v" }, NOW))).toBe("403:CONFLICT_OF_INTEREST");
    expect(h.t.enforcementAction).toHaveLength(0);
    await suspendSeller(h.db, actor("adm", "admin"), "A", { reasonCode: "POLICY_X", publicReason: "v" }, NOW);
    expect(await code(unsuspendSeller(h.db, staffMember, "A", NOW))).toBe("403:CONFLICT_OF_INTEREST");
    expect(h.t.enforcementAction![0]).toMatchObject({ status: "ACTIVE" });
    // a member who is also not the issuer is still refused: COI comes first; a non-member second actor succeeds
    expect(((await unsuspendSeller(h.db, actor("adm2", "admin"), "A", NOW)) as { status: string }).status).toBe("UNVERIFIED");
  });
  it("SEL-011: status is VERIFIED only with a VERIFIED SELLER-scope claim of this seller; a PRODUCT claim or another seller's claim never verifies", async () => {
    const verifyAs = async () => (await suspendSeller(h.db, actor("adm", "admin"), "A", { reasonCode: "TMP_CHECK", publicReason: "tmp" }, NOW), await unsuspendSeller(h.db, actor("adm2", "admin"), "A", NOW)) as { status: string };
    h.t.sellerOwnershipClaim!.push({ id: "c1", sellerId: "A", scope: "PRODUCT", status: "VERIFIED", verifiedAt: NOW, domain: null });
    h.t.sellerOwnershipClaim!.push({ id: "c2", sellerId: "B", scope: "SELLER", status: "VERIFIED", verifiedAt: NOW, domain: "b.com" });
    expect((await verifyAs()).status).toBe("UNVERIFIED");
    h.t.sellerOwnershipClaim!.push({ id: "c3", sellerId: "A", scope: "SELLER", status: "PENDING", verifiedAt: null, domain: "a.com" });
    expect((await verifyAs()).status).toBe("PENDING_VERIFICATION");
    Object.assign(h.t.sellerOwnershipClaim!.find((c) => c.id === "c3")!, { status: "VERIFIED", verifiedAt: NOW });
    expect((await verifyAs()).status).toBe("VERIFIED");
    expect(h.t.seller!.find((s) => s.id === "A")).toMatchObject({ verifiedClaimId: "c3", verifiedDomain: "a.com" });
  });
});
