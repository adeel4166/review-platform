import { beforeEach, describe, expect, it } from "vitest";
import { findPiiAuditKeys, hashEmailToken } from "@rp/core";
import { OWNERSHIP_CHANGE, acceptTransfer, cancelByLink, cancelTransfer, createTransfer, executeTransfer, expireTransfers, planOwnershipChange, listTransfers, staffCancelTransfer } from "./ownership-transfers";
import { removeMember } from "./sellers";
import type { Actor } from "./session";
import { invitationInput, transferCreateInput } from "./validation";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const t0 = (x: unknown) => (x instanceof Date ? x.getTime() : x);
function cmp(r: any, v: any): boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (v instanceof Date) return r instanceof Date && r.getTime() === v.getTime();
  if (v && typeof v === "object") {
    return Object.entries(v).every(([op, x]) => {
      if (op === "in") return (x as unknown[]).includes(r);
      if (op === "not") return !cmp(r, x);
      if (op === "gt") return r != null && (t0(r) as number) > (t0(x) as number);
      if (op === "gte") return r != null && (t0(r) as number) >= (t0(x) as number);
      if (op === "lt") return r != null && (t0(r) as number) < (t0(x) as number);
      if (op === "lte") return r != null && (t0(r) as number) <= (t0(x) as number);
      return false;
    });
  }
  return (r ?? null) === (v ?? null);
}
const match = (r: Row, w: Row = {}): boolean => Object.entries(w).every(([k, v]) => (k === "OR" ? (v as Row[]).some((x) => match(r, x)) : k === "sellerId_userId" ? r.sellerId === v.sellerId && r.userId === v.userId : cmp(r[k], v)));

const NOW = new Date("2026-12-01T10:00:00Z");
const H = 3_600_000;

function world() {
  const t: Record<string, Row[]> = { user: [], seller: [], sellerMember: [], enforcementAction: [], twoFactorTotp: [], sellerOwnershipTransfer: [], sellerTransferCancelToken: [], auditLog: [], outboxEvent: [] };
  let n = 0;
  const table = (name: string, defaults: () => Row = () => ({})) => ({
    findUnique: async ({ where }: Row) => { const r = t[name]!.find((x) => match(x, where)); return r ? { ...r } : null; },
    findFirst: async ({ where }: Row = {}) => { const r = t[name]!.find((x) => match(x, where)); return r ? { ...r } : null; },
    findMany: async ({ where, take }: Row = {}) => t[name]!.filter((x) => match(x, where)).slice(0, take ?? 1e9).map((x) => ({ ...x })),
    count: async ({ where }: Row = {}) => t[name]!.filter((x) => match(x, where)).length,
    create: async ({ data }: Row) => {
      const row = { id: `${name}${++n}`, createdAt: new Date(), ...defaults(), ...data };
      if (name === "sellerOwnershipTransfer" && row.openKey && t[name]!.some((x) => x.openKey === row.openKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
      t[name]!.push(row); return { ...row };
    },
    update: async ({ where, data }: Row) => { const r = t[name]!.find((x) => match(x, where)); if (!r) throw new Error("nf"); Object.assign(r, data); return { ...r }; },
    updateMany: async ({ where, data }: Row) => { const rows = t[name]!.filter((x) => match(x, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
    delete: async ({ where }: Row) => { t[name] = t[name]!.filter((x) => !match(x, where)); },
  });
  const db: Record<string, any> = { $queryRaw: async () => [], $transaction: async (fn: (tx: unknown) => unknown) => fn(db) }; // eslint-disable-line @typescript-eslint/no-explicit-any
  db.user = table("user"); db.seller = table("seller"); db.sellerMember = table("sellerMember"); db.enforcementAction = table("enforcementAction"); db.twoFactorTotp = table("twoFactorTotp");
  db.sellerOwnershipTransfer = table("sellerOwnershipTransfer", () => ({ status: "PENDING", targetOutcome: null, acceptedAt: null, endedAt: null, endReason: null, endedById: null }));
  db.sellerTransferCancelToken = table("sellerTransferCancelToken", () => ({ tokenHash: null, usedAt: null, sentAt: null }));
  db.auditLog = table("auditLog"); db.outboxEvent = table("outboxEvent");
  // sellerMember.delete reads the live array each call
  db.sellerMember.delete = async ({ where }: Row) => { t.sellerMember = t.sellerMember!.filter((x) => !match(x, where)); };
  db.sellerMember.findMany = async ({ where }: Row = {}) => t.sellerMember!.filter((x) => match(x, where)).map((x) => ({ ...x }));
  const user = (id: string, o: { tf?: boolean; status?: string; verified?: boolean } = {}) => {
    t.user!.push({ id, status: o.status ?? "ACTIVE", emailVerifiedAt: o.verified === false ? null : new Date("2026-01-01") });
    if (o.tf !== false) t.twoFactorTotp!.push({ userId: id, confirmedAt: new Date("2026-01-02") });
  };
  t.seller!.push({ id: "S", status: "VERIFIED", closedAt: null });
  user("A"); user("A2"); user("B"); user("M"); user("R");
  t.sellerMember!.push({ sellerId: "S", userId: "A", role: "OWNER" }, { sellerId: "S", userId: "A2", role: "OWNER" }, { sellerId: "S", userId: "B", role: "MANAGER" }, { sellerId: "S", userId: "R", role: "RESPONDER" });
  return { db: db as never, t, user };
}
const actor = (id: string, o: Partial<Actor> = {}): Actor => ({ id, role: "user", twoFactor: { enrolled: true, verified: true }, stepUpAt: NOW.getTime(), ...o });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { const x = e as { status?: number; code?: string }; return `${x.status}:${x.code}`; } };
const role = (w: ReturnType<typeof world>, u: string) => w.t.sellerMember!.find((m) => m.userId === u)?.role ?? null;
const accept = (w: ReturnType<typeof world>, id: string, at: Date, o: Partial<Actor> = {}) => acceptTransfer(w.db, actor("B", { stepUpAt: at.getTime(), ...o }), id, at);
const AFTER = new Date(NOW.getTime() + 72 * H + 1000);

describe("create guards (SEL-006)", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => { w = world(); });
  it("rejects an OWNER without 2FA-verified session (TWO_FACTOR_REQUIRED) and a stale step-up", async () => {
    expect(await code(createTransfer(w.db, actor("A", { twoFactor: { enrolled: true, verified: false } }), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW))).toBe("403:TWO_FACTOR_REQUIRED");
    expect(await code(createTransfer(w.db, actor("A", { twoFactor: { enrolled: false, verified: false } }), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW))).toBe("403:TWO_FACTOR_REQUIRED");
    expect(await code(createTransfer(w.db, actor("A", { stepUpAt: NOW.getTime() - 11 * 60_000 }), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW))).toBe("401:STEP_UP_REQUIRED");
    expect(w.t.sellerOwnershipTransfer).toHaveLength(0);
  });
  it("only an OWNER of THIS seller may start one; non-members get 404", async () => {
    expect(await code(createTransfer(w.db, actor("B"), "S", { kind: "ADD_OWNER", targetUserId: "R" }, NOW))).toBe("403:FORBIDDEN_ROLE");
    expect(await code(createTransfer(w.db, actor("M"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW))).toBe("404:not_found");
  });
  it("the target must be a 2FA-enrolled, active, verified member; not an owner already", async () => {
    w.user("X", { tf: false });
    w.t.sellerMember!.push({ sellerId: "S", userId: "X", role: "MANAGER" });
    expect(await code(createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "X" }, NOW))).toBe("409:target_two_factor_required");
    expect(await code(createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "M" }, NOW))).toBe("409:target_not_member");
    expect(await code(createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "A2" }, NOW))).toBe("409:target_already_owner");
    expect(await code(createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "A" }, NOW))).toBe("400:validation_error");
  });
  it("SEL-021: creates PENDING with the 72 h delay, cancel-token rows for every OWNER and the target; MANAGER -> FORBIDDEN_ROLE; a second open change -> ownership_change_pending", async () => {
    const r = (await createTransfer(w.db, actor("A"), "S", { kind: "TRANSFER", targetUserId: "B", initiatorOutcome: "BECOME_MANAGER" }, NOW)) as { id: string; executeAfter: Date };
    expect(r.executeAfter.getTime() - NOW.getTime()).toBe(OWNERSHIP_CHANGE.delayMs);
    expect(w.t.sellerTransferCancelToken!.map((x) => x.recipientId).sort()).toEqual(["A", "A2", "B"]);
    expect(w.t.outboxEvent!.map((e) => e.type)).toContain("seller.ownership_transfer_requested");
    expect(await code(createTransfer(w.db, actor("B"), "S", { kind: "ADD_OWNER", targetUserId: "R" }, NOW))).toBe("403:FORBIDDEN_ROLE");
    expect(await code(createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "R" }, NOW))).toBe("409:ownership_change_pending");
    for (const l of w.t.auditLog!) expect(findPiiAuditKeys(l.metadata)).toEqual([]);
    expect(role(w, "B")).toBe("MANAGER"); // nothing changes at request time
  });
  it("a suspended seller cannot change ownership", async () => {
    w.t.enforcementAction!.push({ subjectSellerId: "S", type: "SELLER_SUSPENSION", status: "ACTIVE", startsAt: new Date(0), endsAt: null });
    expect(await code(createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW))).toBe("403:SELLER_SUSPENDED");
  });
});

describe("acceptance, the 72 h window and execution", () => {
  let w: ReturnType<typeof world>;
  let id: string;
  beforeEach(async () => {
    w = world();
    id = ((await createTransfer(w.db, actor("A"), "S", { kind: "TRANSFER", targetUserId: "B", initiatorOutcome: "BECOME_MANAGER" }, NOW)) as { id: string }).id;
  });
  it("only the target accepts, with a 2FA-verified session and a step-up", async () => {
    expect(await code(acceptTransfer(w.db, actor("A"), id, NOW))).toBe("404:not_found");
    expect(await code(acceptTransfer(w.db, actor("B", { twoFactor: { enrolled: true, verified: false } }), id, NOW))).toBe("403:TWO_FACTOR_REQUIRED");
    expect(await code(acceptTransfer(w.db, actor("B", { stepUpAt: null }), id, NOW))).toBe("401:STEP_UP_REQUIRED");
    expect(w.t.sellerOwnershipTransfer![0]!.status).toBe("PENDING");
  });
  it("accepting early only records acceptance; no role changes before 72 h even if the executor runs early", async () => {
    expect(await accept(w, id, new Date(NOW.getTime() + H))).toMatchObject({ status: "ACCEPTED" });
    expect(role(w, "B")).toBe("MANAGER");
    expect(await executeTransfer(w.db, id, new Date(NOW.getTime() + 71 * H))).toMatchObject({ status: "ACCEPTED" });
    expect(role(w, "A")).toBe("OWNER");
    expect(role(w, "B")).toBe("MANAGER");
  });
  it("completes after 72 h: B becomes OWNER, A steps down, audited, openKey cleared", async () => {
    await accept(w, id, new Date(NOW.getTime() + H));
    expect(await executeTransfer(w.db, id, AFTER)).toMatchObject({ status: "COMPLETED" });
    expect(role(w, "B")).toBe("OWNER");
    expect(role(w, "A")).toBe("MANAGER");
    expect(w.t.sellerOwnershipTransfer![0]).toMatchObject({ status: "COMPLETED", openKey: null });
    expect(w.t.auditLog!.map((l) => l.action)).toEqual(expect.arrayContaining(["seller.ownership_transfer.requested", "seller.ownership_transfer.accepted", "seller.member.role_changed", "seller.ownership_transfer.completed"]));
    expect(await executeTransfer(w.db, id, AFTER)).toMatchObject({ status: "COMPLETED" }); // idempotent
  });
  it("accepting after the delay executes in the same transaction", async () => {
    expect(await accept(w, id, AFTER)).toMatchObject({ status: "COMPLETED" });
    expect(role(w, "B")).toBe("OWNER");
  });
  it("2FA removed from the target before execution: FAILED(TWO_FACTOR_MISSING), roles untouched", async () => {
    await accept(w, id, new Date(NOW.getTime() + H));
    w.t.twoFactorTotp = w.t.twoFactorTotp!.filter((x) => x.userId !== "B");
    (w.db as Row).twoFactorTotp.findUnique = async ({ where }: Row) => w.t.twoFactorTotp!.find((x) => x.userId === where.userId) ?? null;
    expect(await executeTransfer(w.db, id, AFTER)).toMatchObject({ status: "FAILED", reason: "TWO_FACTOR_MISSING" });
    expect(role(w, "B")).toBe("MANAGER");
    expect(role(w, "A")).toBe("OWNER");
    expect(w.t.sellerOwnershipTransfer![0]).toMatchObject({ status: "FAILED", endReason: "TWO_FACTOR_MISSING" });
  });
  it("the initiator losing OWNER before execution fails the change (INITIATOR_NOT_OWNER)", async () => {
    await accept(w, id, new Date(NOW.getTime() + H));
    w.t.sellerMember!.find((m) => m.userId === "A")!.role = "MANAGER";
    expect(await executeTransfer(w.db, id, AFTER)).toMatchObject({ status: "FAILED", reason: "INITIATOR_NOT_OWNER" });
    expect(role(w, "B")).toBe("MANAGER");
  });
  it("expiry: an unaccepted request EXPIRES after acceptBy and can no longer be accepted", async () => {
    const late = new Date(NOW.getTime() + 7 * 86_400_000 + 1000);
    expect(await code(acceptTransfer(w.db, actor("B", { stepUpAt: late.getTime() }), id, late))).toBe("409:invalid_transition");
    expect(await expireTransfers(w.db, new Date(NOW.getTime() + 6 * 86_400_000))).toEqual({ expired: 0 });
    expect(await expireTransfers(w.db, late)).toEqual({ expired: 1 });
    expect(w.t.sellerOwnershipTransfer![0]).toMatchObject({ status: "EXPIRED", openKey: null });
    expect(role(w, "B")).toBe("MANAGER");
    // a new change can be started once the open one ended
    expect(await code(createTransfer(w.db, actor("A", { stepUpAt: late.getTime() }), "S", { kind: "ADD_OWNER", targetUserId: "B" }, late))).toBe("ok");
  });
});

describe("cancel (T6) and membership changes (T8)", () => {
  let w: ReturnType<typeof world>;
  let id: string;
  beforeEach(async () => {
    w = world();
    id = ((await createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW)) as { id: string }).id;
  });
  it("initiator, any OWNER and the target can cancel in-app without 2FA or step-up; others get 404", async () => {
    expect(await code(cancelTransfer(w.db, actor("R"), id, NOW))).toBe("404:not_found");
    expect(await code(cancelTransfer(w.db, actor("A2", { twoFactor: undefined, stepUpAt: null }), id, NOW))).toBe("ok");
    expect(w.t.sellerOwnershipTransfer![0]).toMatchObject({ status: "CANCELLED", endReason: "CANCELLED_BY_OWNER", openKey: null, endedById: "A2" });
    expect(await code(cancelTransfer(w.db, actor("A"), id, NOW))).toBe("409:invalid_transition");
    expect(await executeTransfer(w.db, id, AFTER)).toMatchObject({ status: "CANCELLED" });
    expect(role(w, "B")).toBe("MANAGER");
  });
  it("the target can cancel an accepted change; a cancelled change cannot be accepted", async () => {
    await accept(w, id, NOW);
    expect(await code(cancelTransfer(w.db, actor("B", { twoFactor: undefined }), id, NOW))).toBe("ok");
    expect(w.t.sellerOwnershipTransfer![0]!.endReason).toBe("CANCELLED_BY_TARGET");
    expect(await code(accept(w, id, NOW))).toBe("409:invalid_transition");
  });
  it("cancel link: works once without a session, replays and garbage give the same 400, an ended transfer ignores it", async () => {
    const raw = "x".repeat(43);
    const tok = w.t.sellerTransferCancelToken!.find((x) => x.recipientId === "A2")!;
    Object.assign(tok, { tokenHash: hashEmailToken(raw), sentAt: NOW });
    expect(await code(cancelByLink(w.db, "garbage-garbage-garbage-garbage", NOW))).toBe("400:invalid_or_expired");
    expect(await code(cancelByLink(w.db, "short", NOW))).toBe("400:invalid_or_expired");
    expect(await cancelByLink(w.db, raw, NOW)).toEqual({ status: "CANCELLED" });
    expect(w.t.sellerOwnershipTransfer![0]).toMatchObject({ status: "CANCELLED", endReason: "CANCELLED_BY_LINK" });
    expect(await code(cancelByLink(w.db, raw, NOW))).toBe("400:invalid_or_expired");
    const raw2 = "y".repeat(43);
    Object.assign(w.t.sellerTransferCancelToken!.find((x) => x.recipientId === "B")!, { tokenHash: hashEmailToken(raw2), sentAt: NOW });
    expect(await code(cancelByLink(w.db, raw2, NOW))).toBe("400:invalid_or_expired"); // transfer already ended; token not burned
    expect(w.t.sellerTransferCancelToken!.find((x) => x.recipientId === "B")!.usedAt).toBeNull();
  });
  it("staff cancel needs ADMIN, a reason, and not being a member (CONFLICT_OF_INTEREST)", async () => {
    expect(await code(staffCancelTransfer(w.db, actor("B"), id, "FRAUD_SUSPECTED", NOW))).toBe("403:forbidden");
    expect(await code(staffCancelTransfer(w.db, actor("adm", { role: "admin" }), id, "x", NOW))).toBe("400:validation_error");
    w.t.sellerMember!.push({ sellerId: "S", userId: "staffM", role: "RESPONDER" });
    expect(await code(staffCancelTransfer(w.db, actor("staffM", { role: "admin" }), id, "FRAUD_SUSPECTED", NOW))).toBe("403:CONFLICT_OF_INTEREST");
    expect(await code(staffCancelTransfer(w.db, actor("adm", { role: "admin" }), id, "FRAUD_SUSPECTED", NOW))).toBe("ok");
    expect(w.t.sellerOwnershipTransfer![0]!.endReason).toBe("CANCELLED_BY_STAFF");
  });
  it("T8: removing or leaving by the target cancels the open change in the same transaction", async () => {
    expect(await code(removeMember(w.db, actor("B"), "S", "B", NOW))).toBe("ok"); // B leaves
    expect(w.t.sellerOwnershipTransfer![0]).toMatchObject({ status: "CANCELLED", endReason: "CANCELLED_MEMBERSHIP_CHANGED" });
  });
});

describe("OWNER invariants", () => {
  it("an OWNER cannot remove another OWNER directly (use_ownership_change); the last OWNER cannot leave", async () => {
    const w = world();
    expect(await code(removeMember(w.db, actor("A"), "S", "A2", NOW))).toBe("409:use_ownership_change");
    expect(role(w, "A2")).toBe("OWNER");
    expect(await code(removeMember(w.db, actor("A2"), "S", "A2", NOW))).toBe("ok"); // leaving is immediate while another OWNER remains
    expect(await code(removeMember(w.db, actor("A"), "S", "A", NOW))).toBe("409:last_owner");
    expect(role(w, "A")).toBe("OWNER");
  });
  it("REMOVE_OWNER needs no acceptance, waits 72 h, then demotes; the target can cancel", async () => {
    const w = world();
    const r = (await createTransfer(w.db, actor("A"), "S", { kind: "REMOVE_OWNER", targetUserId: "A2", targetOutcome: "BECOME_MANAGER" }, NOW)) as { id: string; status: string };
    expect(r.status).toBe("ACCEPTED");
    expect(await executeTransfer(w.db, r.id, new Date(NOW.getTime() + H))).toMatchObject({ status: "ACCEPTED" });
    expect(role(w, "A2")).toBe("OWNER");
    expect(await executeTransfer(w.db, r.id, AFTER)).toMatchObject({ status: "COMPLETED" });
    expect(role(w, "A2")).toBe("MANAGER");
    expect(role(w, "A")).toBe("OWNER");
  });
  it("planOwnershipChange never leaves a seller without an OWNER", () => {
    const roles = new Map([["A", "OWNER"], ["B", "MANAGER"]] as const);
    expect(planOwnershipChange("TRANSFER", roles, "A", "B", "REMOVED", null)).toMatchObject({ ok: true });
    // initiator demoted while target is the only other OWNER and also removed: impossible -> LAST_OWNER
    expect(planOwnershipChange("REMOVE_OWNER", new Map([["A", "OWNER"]]), "A", "A", "REMAIN_OWNER", "REMOVED")).toEqual({ ok: false, reason: "LAST_OWNER" });
    expect(planOwnershipChange("ADD_OWNER", new Map([["A", "MANAGER"], ["B", "MANAGER"]]), "A", "B", "REMAIN_OWNER", null)).toEqual({ ok: false, reason: "INITIATOR_NOT_OWNER" });
    expect(planOwnershipChange("TRANSFER", new Map([["A", "OWNER"], ["B", "OWNER"]]), "A", "B", "BECOME_MANAGER", null)).toEqual({ ok: false, reason: "TARGET_NOT_ELIGIBLE" });
  });
});

// ---- M3b gate (task #63): named P0 assertions SEL-020..029 ----
type W = ReturnType<typeof world>;
const LIVE = ["PENDING", "ACCEPTED"];
const STATUSES = ["PENDING", "ACCEPTED", "COMPLETED", "CANCELLED", "EXPIRED", "FAILED"];
const adminActor = () => actor("adm", { role: "admin" });
const ACTIONS: Record<string, { allowed: string[]; run: (w: W, id: string, raw: string) => Promise<unknown> }> = {
  accept: { allowed: ["PENDING"], run: (w, id) => acceptTransfer(w.db, actor("B"), id, NOW) },
  cancel: { allowed: LIVE, run: (w, id) => cancelTransfer(w.db, actor("A"), id, NOW) },
  "staff cancel": { allowed: LIVE, run: (w, id) => staffCancelTransfer(w.db, adminActor(), id, "FRAUD_SUSPECTED", NOW) },
  "cancel link": { allowed: LIVE, run: (w, _id, raw) => cancelByLink(w.db, raw, NOW) },
};

describe("SEL-020: status x action matrix", () => {
  for (const [name, a] of Object.entries(ACTIONS)) {
    for (const s of STATUSES) {
      it(`SEL-020: ${name} on a ${s} change: ${a.allowed.includes(s) ? "allowed" : "invalid_transition, no row change, no audit"}`, async () => {
        const w = world();
        const id = ((await createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW)) as { id: string }).id;
        Object.assign(w.t.sellerOwnershipTransfer![0]!, { status: s, acceptedAt: s === "PENDING" ? null : NOW, endedAt: LIVE.includes(s) ? null : NOW, openKey: LIVE.includes(s) ? "S" : null, endReason: s === "CANCELLED" ? "CANCELLED_BY_INITIATOR" : null });
        const raw = "z".repeat(43);
        Object.assign(w.t.sellerTransferCancelToken!.find((x) => x.transferId === id && x.recipientId === "A2")!, { tokenHash: hashEmailToken(raw) });
        const before = JSON.stringify([w.t.sellerOwnershipTransfer, w.t.auditLog]);
        const got = await code(a.run(w, id, raw));
        if (a.allowed.includes(s)) {
          expect(got).toBe("ok");
          expect(w.t.sellerOwnershipTransfer![0]!.status).not.toBe(s);
        } else {
          expect(got).toBe(name === "cancel link" ? "400:invalid_or_expired" : "409:invalid_transition");
          expect(JSON.stringify([w.t.sellerOwnershipTransfer, w.t.auditLog])).toBe(before);
        }
      });
    }
  }
});

describe("SEL-022: the 72 h floor", () => {
  it("chk_transfer_delay is declared with the 72 h floor in the migration (static pin; the live MySQL insert is NOT RUN)", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../../../packages/db/prisma/migrations/20261212000000_ownership_transfers/migration.sql", import.meta.url), "utf8");
    expect(sql).toContain("ADD CONSTRAINT `chk_transfer_delay` CHECK (TIMESTAMPDIFF(SECOND, `createdAt`, `executeAfter`) >= 259200 AND `acceptBy` > `executeAfter`)");
    expect(OWNERSHIP_CHANGE.delayMs / 1000).toBe(259200);
  });
  it("accepting at 1 h records ACCEPTED; the executor is a no-op at 72 h - 1 ms and completes at exactly 72 h", async () => {
    const w = world();
    const id = ((await createTransfer(w.db, actor("A"), "S", { kind: "TRANSFER", targetUserId: "B", initiatorOutcome: "BECOME_MANAGER" }, NOW)) as { id: string }).id;
    await accept(w, id, new Date(NOW.getTime() + H));
    expect(await executeTransfer(w.db, id, new Date(NOW.getTime() + 72 * H - 1))).toMatchObject({ status: "ACCEPTED" });
    expect(role(w, "B")).toBe("MANAGER");
    expect(await executeTransfer(w.db, id, new Date(NOW.getTime() + 72 * H))).toMatchObject({ status: "COMPLETED" });
    expect(role(w, "B")).toBe("OWNER");
  });
});

describe("SEL-023: cancel tokens are stored as hashes", () => {
  it("no row holds the raw token; a hash-only row is found by cancelByLink", async () => {
    const w = world();
    await createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW);
    expect(w.t.sellerTransferCancelToken!.every((x) => x.tokenHash === null)).toBe(true);
    const raw = "h".repeat(43);
    Object.assign(w.t.sellerTransferCancelToken![0]!, { tokenHash: hashEmailToken(raw), sentAt: NOW });
    expect(JSON.stringify(w.t.sellerTransferCancelToken)).not.toContain(raw);
    expect(await cancelByLink(w.db, raw, NOW)).toEqual({ status: "CANCELLED" });
  });
  it.todo("SEL-023: the worker mints and mails one link per recipient, and a reminder at T - 24 h invalidates the earlier link (QA-M3B-07: no minting, mailing or reminder code exists)");
});

describe("SEL-024: a token cancels only its own transfer", () => {
  it("another transfer's token cannot cancel this one; after a cancel, accept -> invalid_transition", async () => {
    const w = world();
    const t1 = ((await createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW)) as { id: string }).id;
    await cancelTransfer(w.db, actor("A"), t1, NOW);
    const t2 = ((await createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW)) as { id: string }).id;
    const raw = "k".repeat(43);
    Object.assign(w.t.sellerTransferCancelToken!.find((x) => x.transferId === t1 && x.recipientId === "A2")!, { tokenHash: hashEmailToken(raw) });
    expect(await code(cancelByLink(w.db, raw, NOW))).toBe("400:invalid_or_expired");
    expect(w.t.sellerOwnershipTransfer!.find((x) => x.id === t2)).toMatchObject({ status: "PENDING", openKey: "S" });
    expect(w.t.sellerTransferCancelToken!.find((x) => x.transferId === t1 && x.recipientId === "A2")!.usedAt).toBeNull();
    expect(await code(acceptTransfer(w.db, actor("B"), t1, NOW))).toBe("409:invalid_transition");
  });
});

describe("SEL-025: execution re-checks suspension and eligibility", () => {
  const acceptedTransfer = async () => {
    const w = world();
    const id = ((await createTransfer(w.db, actor("A"), "S", { kind: "TRANSFER", targetUserId: "B", initiatorOutcome: "BECOME_MANAGER" }, NOW)) as { id: string }).id;
    await accept(w, id, new Date(NOW.getTime() + H));
    return { w, id };
  };
  it("seller suspended after acceptance -> FAILED SELLER_BLOCKED at execution, no role change", async () => {
    const { w, id } = await acceptedTransfer();
    w.t.enforcementAction!.push({ subjectSellerId: "S", type: "SELLER_SUSPENSION", status: "ACTIVE", startsAt: new Date(0), endsAt: null });
    expect(await executeTransfer(w.db, id, AFTER)).toMatchObject({ status: "FAILED", reason: "SELLER_BLOCKED" });
    expect(role(w, "A")).toBe("OWNER");
    expect(role(w, "B")).toBe("MANAGER");
    expect(w.t.sellerOwnershipTransfer![0]).toMatchObject({ status: "FAILED", endReason: "SELLER_BLOCKED" });
  });
  it("target banned after acceptance -> FAILED TARGET_NOT_ELIGIBLE at execution, no role change", async () => {
    const { w, id } = await acceptedTransfer();
    w.t.user!.find((u) => u.id === "B")!.status = "BANNED";
    expect(await executeTransfer(w.db, id, AFTER)).toMatchObject({ status: "FAILED", reason: "TARGET_NOT_ELIGIBLE" });
    expect(role(w, "A")).toBe("OWNER");
    expect(role(w, "B")).toBe("MANAGER");
  });
});

describe("SEL-026: seller row lock and the >= 1 OWNER invariant", () => {
  const ops: Record<string, (w: W, id: string) => Promise<unknown>> = {
    create: (w) => createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW),
    accept: (w, id) => acceptTransfer(w.db, actor("B"), id, NOW),
    cancel: (w, id) => cancelTransfer(w.db, actor("A"), id, NOW),
    "staff cancel": (w, id) => staffCancelTransfer(w.db, adminActor(), id, "FRAUD_SUSPECTED", NOW),
    execute: (w, id) => executeTransfer(w.db, id, AFTER),
    "member leaves": (w) => removeMember(w.db, actor("A2"), "S", "A2", NOW),
  };
  for (const [name, op] of Object.entries(ops)) {
    it(`SEL-026: ${name} takes SELECT ... FOR UPDATE on the seller first (live interleaving: NOT RUN, needs MySQL)`, async () => {
      const w = world();
      const id = ((await createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW)) as { id: string }).id;
      const locks: string[] = [];
      (w.db as Row).$queryRaw = async (strings: TemplateStringsArray) => { locks.push(strings.join("?")); return []; };
      await op(w, id).catch(() => undefined);
      expect(locks.some((s) => s.includes("FOR UPDATE"))).toBe(true);
    });
  }
  it("REMOVE_OWNER of a co-owner after the initiator left is cancelled, and the seller keeps an OWNER", async () => {
    const w = world();
    const r = (await createTransfer(w.db, actor("A"), "S", { kind: "REMOVE_OWNER", targetUserId: "A2", targetOutcome: "BECOME_MANAGER" }, NOW)) as { id: string };
    expect(await code(removeMember(w.db, actor("A"), "S", "A", NOW))).toBe("ok");
    expect(w.t.sellerOwnershipTransfer!.find((x) => x.id === r.id)).toMatchObject({ status: "CANCELLED", endReason: "CANCELLED_MEMBERSHIP_CHANGED" });
    expect(await executeTransfer(w.db, r.id, AFTER)).toMatchObject({ status: "CANCELLED" });
    expect(role(w, "A2")).toBe("OWNER");
    expect(w.t.sellerMember!.filter((m) => m.role === "OWNER").length).toBeGreaterThanOrEqual(1);
  });
});

describe("SEL-028: initiator membership change; invitations cannot grant OWNER", () => {
  it("the initiator leaving cancels the open change in the same transaction (CANCELLED_MEMBERSHIP_CHANGED)", async () => {
    const w = world();
    await createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW);
    expect(await code(removeMember(w.db, actor("A"), "S", "A", NOW))).toBe("ok");
    expect(w.t.sellerOwnershipTransfer![0]).toMatchObject({ status: "CANCELLED", endReason: "CANCELLED_MEMBERSHIP_CHANGED", openKey: null });
    expect(w.t.auditLog!.map((l) => l.action)).toContain("seller.ownership_transfer.cancelled");
  });
  it("an invitation with role OWNER is refused by the input schema; MANAGER is accepted", () => {
    expect(invitationInput.safeParse({ email: "new@acme.com", role: "OWNER" }).success).toBe(false);
    expect(invitationInput.safeParse({ email: "new@acme.com", role: "MANAGER" }).success).toBe(true);
  });
});

describe("SEL-029: cross-seller isolation and the body shape", () => {
  it("an OWNER of seller S2 cannot create on S, list, accept or cancel S's change (404 each)", async () => {
    const w = world();
    w.t.seller!.push({ id: "S2", status: "VERIFIED", closedAt: null });
    w.user("C");
    w.t.sellerMember!.push({ sellerId: "S2", userId: "C", role: "OWNER" });
    const id = ((await createTransfer(w.db, actor("A"), "S", { kind: "ADD_OWNER", targetUserId: "B" }, NOW)) as { id: string }).id;
    expect(await code(createTransfer(w.db, actor("C"), "S", { kind: "ADD_OWNER", targetUserId: "R" }, NOW))).toBe("404:not_found");
    expect(await code(listTransfers(w.db, actor("C"), "S", NOW))).toBe("404:not_found");
    expect(await code(acceptTransfer(w.db, actor("C"), id, NOW))).toBe("404:not_found");
    expect(await code(cancelTransfer(w.db, actor("C"), id, NOW))).toBe("404:not_found");
    expect(w.t.sellerOwnershipTransfer![0]).toMatchObject({ status: "PENDING", openKey: "S" });
  });
  it("sellerId in the request body is refused (strict input schema)", () => {
    expect(transferCreateInput.safeParse({ kind: "ADD_OWNER", targetUserId: "B", sellerId: "S2" }).success).toBe(false);
  });
});
