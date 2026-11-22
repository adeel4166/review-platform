import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeClock, baseConfig, baseConfigRaw } from "@rp/core/testing";
import { addDays, addHours, canonicalJson } from "@rp/core";
import { createHash } from "node:crypto";
import { makeFakeDb } from "./m4-fake-db";
import { approveRequest, rejectOrCancel, requestConfigActivation, requestRoleGrant, requestTwoFactorReset, type Staff } from "./approvals";
import { requestOriginalAccess, serveOriginal } from "./break-glass";
import { appealDto, claimAppeal, decideAppeal, fileAppeal, getOwnAppeal, withdrawAppeal, type AppealDeps } from "./appeals";

const NAMES = ["staffApprovalRequest", "moderationConfig", "userRole", "userSession", "twoFactorTotp", "twoFactorRecoveryCode", "auditLog", "outboxEvent", "user", "breakGlassAccess", "purchaseProof", "purchaseProofFile", "appeal", "moderationCase", "moderationDecision", "enforcementAction", "report"];
const staff = (id: string, roles: Staff["roles"], clock: FakeClock): Staff => ({ id, roles, stepUpAt: clock.now().getTime() - 1000 });
const mk = () => { const clock = new FakeClock(); const f = makeFakeDb(NAMES); return { clock, db: f.db as any, t: f.t as any }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
const seedUser = (t: any, id: string) => { t.user.push({ id, status: "ACTIVE", emailVerifiedAt: new Date() }); t.twoFactorTotp.push({ id: `tf${id}`, userId: id, confirmedAt: new Date() }); }; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("CFG-004 / SEC-010 config activation is four-eyes", () => {
  const draft = (t: any, version: string, raw = baseConfigRaw()) => { const config = { ...raw, version }; t.moderationConfig.push({ id: `c${version}`, version, status: "DRAFT", config, checksum: createHash("sha256").update(canonicalJson(config)).digest("hex") }); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  it("requester cannot activate alone; a second ADMIN approves; previous ACTIVE -> RETIRED; audit written", async () => {
    const { clock, db, t } = mk();
    t.moderationConfig.push({ id: "old", version: "v0", status: "ACTIVE", config: baseConfigRaw(), checksum: "x" });
    draft(t, "v1");
    const a1 = staff("a1", ["ADMIN"], clock), a2 = staff("a2", ["ADMIN"], clock);
    const { approvalRequestId } = await requestConfigActivation(db, a1, "v1", clock);
    expect(t.moderationConfig.find((c: any) => c.version === "v1").status).toBe("DRAFT"); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(approveRequest(db, a1, approvalRequestId, clock)).rejects.toMatchObject({ code: "approval_self", status: 403 });
    await approveRequest(db, a2, approvalRequestId, clock);
    const byV = (v: string) => t.moderationConfig.find((c: any) => c.version === v); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect([byV("v0").status, byV("v1").status, byV("v1").approvedById]).toEqual(["RETIRED", "ACTIVE", "a2"]);
    expect(t.auditLog.some((a: any) => a.action === "config.activate")).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(approveRequest(db, a2, approvalRequestId, clock)).rejects.toMatchObject({ code: "not_pending" });
  });
  it("a draft that weakens a floor cannot even be requested; a second pending request -> 409; expiry and step-up", async () => {
    const { clock, db, t } = mk();
    const raw = baseConfigRaw() as any; raw.strikes.zeroTolerance = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    draft(t, "bad", raw); draft(t, "ok");
    const a1 = staff("a1", ["ADMIN"], clock);
    await expect(requestConfigActivation(db, a1, "bad", clock)).rejects.toMatchObject({ status: 422, code: "config_floor_violation" });
    const { approvalRequestId } = await requestConfigActivation(db, a1, "ok", clock);
    await expect(requestConfigActivation(db, a1, "ok", clock)).rejects.toMatchObject({ code: "approval_pending" });
    await expect(requestConfigActivation(db, { ...a1, stepUpAt: null }, "ok", clock)).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    clock.advance(25 * 3_600_000);
    await expect(approveRequest(db, staff("a2", ["ADMIN"], clock), approvalRequestId, clock)).rejects.toMatchObject({ code: "approval_expired" });
    expect(baseConfig().version).toBeTruthy();
  });
});

describe("AZ-015 / SEC-010 role grants, AZ-024 2FA reset", () => {
  it("SENIOR_MODERATOR+ needs a second SUPER_ADMIN (202); MODERATOR is single actor; ADMIN cannot grant ADMIN", async () => {
    const { clock, db, t } = mk();
    seedUser(t, "u1");
    const s1 = staff("s1", ["SUPER_ADMIN"], clock), s2 = staff("s2", ["SUPER_ADMIN"], clock);
    const r = await requestRoleGrant(db, s1, "u1", "ADMIN", "needed", clock);
    expect(r.status).toBe(202);
    expect(t.userRole).toHaveLength(0);
    await approveRequest(db, s2, (r as { approvalRequestId: string }).approvalRequestId, clock);
    expect(t.userRole).toEqual([expect.objectContaining({ userId: "u1", role: "ADMIN" })]);
    await expect(requestRoleGrant(db, staff("a1", ["ADMIN"], clock), "u1", "ADMIN", "x", clock)).rejects.toMatchObject({ status: 403 });
    expect((await requestRoleGrant(db, staff("a1", ["ADMIN"], clock), "u1", "MODERATOR", "x", clock)).status).toBe(201);
    await expect(requestRoleGrant(db, s1, "s1", "MODERATOR", "self", clock)).rejects.toMatchObject({ status: 403 });
  });
  it("2FA reset: second approver required; TOTP removed, sessions revoked, security alert emitted", async () => {
    const { clock, db, t } = mk();
    seedUser(t, "adm"); t.userSession.push({ id: "ss", userId: "adm", revokedAt: null });
    const a1 = staff("a1", ["ADMIN"], clock);
    const { approvalRequestId } = await requestTwoFactorReset(db, a1, "adm", clock);
    await expect(approveRequest(db, a1, approvalRequestId, clock)).rejects.toMatchObject({ code: "approval_self" });
    await approveRequest(db, staff("s2", ["SUPER_ADMIN"], clock), approvalRequestId, clock);
    expect(t.twoFactorTotp).toHaveLength(0);
    expect(t.userSession[0].revokedAt).toBeTruthy();
    expect(t.outboxEvent.some((o: any) => o.type === "auth.security_alert")).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(rejectOrCancel(db, a1, approvalRequestId, "cancel", undefined, clock)).rejects.toMatchObject({ code: "not_pending" });
  });
});

describe("PRV-003 / BGL-001 break-glass", () => {
  const seed = (t: any) => { t.purchaseProof.push({ id: "p1", submittedById: "buyer" }); t.purchaseProofFile.push({ id: "f1", proofId: "p1", isRedacted: false, purgedAt: null }); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const reason = "Order id on the proof does not match the dispute";
  it("writes the access + audit row, serves once, then refuses (single use, session bound, 60 s)", async () => {
    const { clock, db, t } = mk(); seed(t);
    const s = { ...staff("smod", ["SENIOR_MODERATOR"], clock), sessionId: "sess1" };
    const alerts: string[] = [];
    const r = await requestOriginalAccess(db, s, { proofId: "p1", fileId: "f1", reasonCode: "DISPUTE", reasonText: reason }, clock, (k) => void alerts.push(k));
    expect(r.status).toBe(201);
    expect(t.auditLog.map((a: any) => a.action)).toEqual(["proof.view_original"]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const store = { getObject: async (key: string) => { expect(key).toBe("proof/f1/orig"); return { body: new Uint8Array([1]), contentType: "image/png" }; } };
    const id = (r as { accessId: string }).accessId;
    await expect(serveOriginal(db, store, { staffId: "smod", sessionId: "other" }, id, clock)).rejects.toMatchObject({ status: 404 });
    const out = await serveOriginal(db, store, { staffId: "smod", sessionId: "sess1" }, id, clock);
    expect(out.headers["Cache-Control"]).toBe("no-store");
    expect(t.auditLog.map((a: any) => a.action)).toContain("proof.view_original.served"); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(serveOriginal(db, store, { staffId: "smod", sessionId: "sess1" }, id, clock)).rejects.toMatchObject({ code: "access_used" });
    expect(alerts).toEqual([]);
  });
  it("expired access, repeat on the same submitter (202 approval), cap, purged original, short reason", async () => {
    const { clock, db, t } = mk(); seed(t);
    const s = { ...staff("smod", ["SENIOR_MODERATOR"], clock), sessionId: "sess1" };
    const call = (x: Partial<{ reasonText: string }> = {}) => requestOriginalAccess(db, s, { proofId: "p1", fileId: "f1", reasonCode: "DISPUTE", reasonText: reason, ...x }, clock, () => {});
    const first = await call() as { accessId: string };
    clock.advance(60_000);
    await expect(serveOriginal(db, { getObject: async () => ({ body: new Uint8Array(), contentType: "x" }) }, { staffId: "smod", sessionId: "sess1" }, first.accessId, clock)).rejects.toMatchObject({ code: "access_expired" });
    expect((await call()).status).toBe(202); // same submitter within 7 d
    await expect(call({ reasonText: "short" })).rejects.toMatchObject({ status: 400 });
    t.purchaseProofFile[0].purgedAt = new Date();
    await expect(call()).rejects.toMatchObject({ status: 410, code: "original_purged" });
    t.purchaseProofFile[0].purgedAt = null;
    for (let i = 0; i < 20; i++) t.breakGlassAccess.push({ staffId: "smod", submitterId: `x${i}`, createdAt: clock.now() });
    await expect(call()).rejects.toMatchObject({ status: 429, code: "break_glass_cap" });
  });
  it("static: `/orig/` keys are read only by break-glass.ts and never presigned (replaces SEC-M4-10)", () => {
    const root = join(__dirname, "..");
    const hits: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && /presignGet[^;]*orig|orig[^;]*presignGet|originalKey/.test(readFileSync(p, "utf8"))) hits.push(p.replace(root, "")); } };
    walk(root);
    expect(hits.filter((h) => !h.endsWith("break-glass.ts") && !h.includes("proofs.ts") && !h.includes("admin") )).toEqual([]);
    expect(readFileSync(join(root, "server/break-glass.ts"), "utf8")).not.toMatch(/presignGet/);
  });
});

describe("appeals (APL-001..004, TMR-011, MOD-013/025)", () => {
  const seed = (t: any, clock: FakeClock, over: any = {}) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    t.moderationCase.push({ id: "c1", version: 1, authorId: "author", resolutionCode: "X", appealableUntil: addDays(clock.now(), 30), ...over });
    t.moderationDecision.push({ id: "d1", caseId: "c1", contentVersion: 1, source: "HUMAN", moderatorId: "mod1", createdAt: clock.now(), publicReason: "spam" });
  };
  const deps = (db: any, clock: FakeClock, overturned: string[] = [], limit = async () => true): AppealDeps => ({ db, clock, config: baseConfig(), limit, applyOverturn: async (_tx, a) => void overturned.push(a.id) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  it("TMR-011 window: accepted 1 s before the end, refused at/after it", async () => {
    const { clock, db, t } = mk(); seed(t, clock);
    const end = t.moderationCase[0].appealableUntil as Date;
    clock.set(new Date(end.getTime() - 1000));
    await expect(fileAppeal(deps(db, clock), { id: "author" }, { caseId: "c1", statement: "this decision was wrong" })).resolves.toHaveProperty("id");
    t.appeal.length = 0;
    clock.set(new Date(end.getTime() + 1000));
    await expect(fileAppeal(deps(db, clock), { id: "author" }, { caseId: "c1", statement: "this decision was wrong" })).rejects.toMatchObject({ code: "appeal_window_closed" });
  });
  it("SLA: 72 h for HOLD_EXPIRED else 168 h; one appeal per appellant; stranger gets 404; 4th in 24 h -> 429; stale version -> 409", async () => {
    const { clock, db, t } = mk(); seed(t, clock, { resolutionCode: "HOLD_EXPIRED" });
    const a = await fileAppeal(deps(db, clock), { id: "author" }, { caseId: "c1", statement: "this decision was wrong" });
    expect(t.appeal[0].slaDueAt).toEqual(addHours(clock.now(), 72));
    await expect(fileAppeal(deps(db, clock), { id: "author" }, { caseId: "c1", statement: "this decision was wrong" })).rejects.toMatchObject({ code: "appeal_exists" });
    await expect(fileAppeal(deps(db, clock), { id: "stranger" }, { caseId: "c1", statement: "this decision was wrong" })).rejects.toMatchObject({ status: 404 });
    await expect(fileAppeal(deps(db, clock, [], async () => false), { id: "author" }, { caseId: "c1", statement: "this decision was wrong" })).rejects.toMatchObject({ status: 429 });
    t.moderationCase[0].version = 2;
    await expect(fileAppeal(deps(db, clock), { id: "u2" }, { caseId: "c1", statement: "this decision was wrong" })).rejects.toMatchObject({ status: 404 });
    expect(a.id).toBeTruthy();
  });
  it("APL-001 / APL-002 another user cannot read or withdraw; the DTO has no staff ids, scores or notes", async () => {
    const { clock, db, t } = mk(); seed(t, clock);
    const { id } = await fileAppeal(deps(db, clock), { id: "author" }, { caseId: "c1", statement: "this decision was wrong" });
    await expect(getOwnAppeal(db, "other", id)).rejects.toMatchObject({ status: 404 });
    await expect(withdrawAppeal(deps(db, clock), "other", id)).rejects.toMatchObject({ status: 404 });
    const dto = appealDto({ ...t.appeal[0], reviewerId: "staff9", decisionNote: "n" }, { ...t.moderationCase[0], source: "HUMAN", aiScore: 0.9, publicReason: "spam" });
    expect(Object.keys(dto)).not.toEqual(expect.arrayContaining(["reviewerId", "aiScore", "moderatorId", "reporterId"]));
    expect(JSON.stringify(dto)).not.toMatch(/staff9|0\.9|mod1/);
  });
  it("A2/A3/A4: COI (prior decider, appellant), lease at commit, decisionNote immutable, overturn runs the content effect", async () => {
    const { clock, db, t } = mk(); seed(t, clock);
    const over: string[] = [];
    const d = deps(db, clock, over);
    const { id } = await fileAppeal(d, { id: "author" }, { caseId: "c1", statement: "this decision was wrong" });
    await expect(claimAppeal(d, "mod1", id)).rejects.toMatchObject({ code: "CONFLICT_OF_INTEREST" });
    await expect(claimAppeal(d, "author", id)).rejects.toMatchObject({ code: "CONFLICT_OF_INTEREST" });
    await claimAppeal(d, "smod2", id);
    await expect(claimAppeal(d, "smod3", id)).rejects.toMatchObject({ code: "lease_not_held" });
    clock.advance(16 * 60_000);
    await expect(decideAppeal(d, "smod2", id, { outcome: "OVERTURNED", decisionNote: "wrong call" })).rejects.toMatchObject({ code: "lease_not_held" });
    await claimAppeal(d, "smod2", id);
    expect(await decideAppeal(d, "smod2", id, { outcome: "OVERTURNED", decisionNote: "wrong call" })).toMatchObject({ status: 200 });
    expect(over).toEqual([id]);
    await expect(decideAppeal(d, "smod2", id, { outcome: "UPHELD", decisionNote: "changed my mind" })).rejects.toMatchObject({ status: 409 });
    expect(t.appeal[0].decisionNote).toBe("wrong call");
  });
  it("MOD-025 / AP-2: the overturn effect refuses a changed content version and nothing is decided", async () => {
    const { clock, db, t } = mk(); seed(t, clock);
    const d = { ...deps(db, clock), applyOverturn: async () => { throw Object.assign(new Error("version_superseded"), { status: 409, code: "version_superseded" }); } } as AppealDeps;
    const { id } = await fileAppeal(d, { id: "author" }, { caseId: "c1", statement: "this decision was wrong" });
    await claimAppeal(d, "smod2", id);
    await expect(decideAppeal(d, "smod2", id, { outcome: "OVERTURNED", decisionNote: "n" })).rejects.toMatchObject({ code: "version_superseded" });
    expect(t.appeal[0].status).toBe("IN_REVIEW");
  });
  it("APL-004 / AP-1: overturning an appeal against a BAN without a second approver is refused (202, nothing decided)", async () => {
    const { clock, db, t } = mk();
    t.enforcementAction.push({ id: "e1", type: "BAN", issuedById: "x" });
    t.appeal.push({ id: "ap", appellantId: "u", enforcementActionId: "e1", caseId: null, status: "IN_REVIEW", reviewerId: "smod2", leaseExpiresAt: addHours(clock.now(), 1), decisionNote: null });
    const over: string[] = [];
    const r = await decideAppeal(deps(db, clock, over), "smod2", "ap", { outcome: "OVERTURNED", decisionNote: "n" });
    expect(r.status).toBe(202);
    expect(over).toEqual([]);
    expect(t.appeal[0].status).toBe("IN_REVIEW");
    expect(t.staffApprovalRequest[0]).toMatchObject({ kind: "ENFORCEMENT_OVERTURN_MAJOR", status: "PENDING" });
  });
});

describe("CLOSE-01 (task #83): SEC-M6-01/03/04/05/06", () => {
  it("SEC-M6-01/06: unknown role is refused at request time; target drift (2FA removed) is refused at execution, userRole untouched", async () => {
    const { clock, db, t } = mk();
    seedUser(t, "u1");
    const s1 = staff("s1", ["SUPER_ADMIN"], clock), s2 = staff("s2", ["SUPER_ADMIN"], clock);
    await expect(requestRoleGrant(db, s1, "u1", "ROOT" as never, "x", clock)).rejects.toMatchObject({ status: 400, code: "invalid_role" });
    const r = await requestRoleGrant(db, s1, "u1", "ADMIN", "needed", clock) as { approvalRequestId: string };
    t.twoFactorTotp.length = 0; // target lost 2FA between request and approval
    await expect(approveRequest(db, s2, r.approvalRequestId, clock)).rejects.toMatchObject({ status: 409, code: "target_two_factor_missing" });
    expect(t.userRole).toHaveLength(0);
    t.twoFactorTotp.push({ id: "tf", userId: "u1", confirmedAt: new Date() });
    t.user[0].status = "SUSPENDED";
    await expect(approveRequest(db, s2, r.approvalRequestId, clock)).rejects.toMatchObject({ status: 409, code: "target_not_eligible" });
    expect(t.userRole).toHaveLength(0);
  });
  it("SEC-M6-05: ADMINs cannot reset a staff member's 2FA; a SUPER_ADMIN requester + approver can; alert kind is TWO_FACTOR_RESET", async () => {
    const { clock, db, t } = mk();
    seedUser(t, "boss"); t.userRole.push({ userId: "boss", role: "SUPER_ADMIN" });
    await expect(requestTwoFactorReset(db, staff("a1", ["ADMIN"], clock), "boss", clock)).rejects.toMatchObject({ status: 403 });
    const { approvalRequestId } = await requestTwoFactorReset(db, staff("s1", ["SUPER_ADMIN"], clock), "boss", clock);
    await expect(approveRequest(db, staff("a2", ["ADMIN"], clock), approvalRequestId, clock)).rejects.toMatchObject({ status: 403 });
    expect(t.twoFactorTotp).toHaveLength(1);
    await approveRequest(db, staff("s2", ["SUPER_ADMIN"], clock), approvalRequestId, clock);
    expect(t.twoFactorTotp).toHaveLength(0);
    expect(t.outboxEvent.find((o: any) => o.type === "auth.security_alert").payload.kind).toBe("TWO_FACTOR_RESET"); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it("SEC-M6-04: the worker mails TWO_FACTOR_RESET (not SKIPPED) and an unknown kind is skipped but logged", async () => {
    const { sendSecurityAlertEmail } = await import("../../../worker/src/email");
    const sent: unknown[] = [];
    const d = { db: { user: { findUnique: async () => ({ email: "u@example.test", status: "ACTIVE" }) } }, mail: { send: async (m: unknown) => void sent.push(m) } } as never;
    expect(await sendSecurityAlertEmail(d, { userId: "u", kind: "TWO_FACTOR_RESET" }, "k1")).toBe("SENT");
    expect(sent).toHaveLength(1);
  });
  it("SEC-M6-03: break-glass has no fallback record; the file must belong to the proof and be unredacted; the key is built from the DB file id", async () => {
    const { clock, db, t } = mk();
    t.purchaseProof.push({ id: "p1", submittedById: "buyer" }, { id: "p2", submittedById: "buyer" });
    t.purchaseProofFile.push({ id: "f1", proofId: "p1", isRedacted: false, purgedAt: null }, { id: "fr", proofId: "p1", isRedacted: true, purgedAt: null }, { id: "../x", proofId: "p1", isRedacted: false, purgedAt: null });
    const s = { ...staff("smod", ["SENIOR_MODERATOR"], clock), sessionId: "sess1" };
    const call = (proofId: string, fileId: string) => requestOriginalAccess(db, s, { proofId, fileId, reasonCode: "DISPUTE", reasonText: "Order id on the proof does not match the dispute" }, clock, () => {});
    await expect(call("p1", "missing")).rejects.toMatchObject({ status: 404 }); // no fallback "exists" record
    await expect(call("p2", "f1")).rejects.toMatchObject({ status: 404 }); // fileId bound to proofId
    await expect(call("p1", "fr")).rejects.toMatchObject({ status: 404 }); // redacted derivative is not the original
    const r = await call("p1", "../x") as { accessId: string }; // an odd id is stored but can never be turned into a key
    const store = { getObject: async () => { throw new Error("must not read"); } };
    await expect(serveOriginal(db, store, { staffId: "smod", sessionId: "sess1" }, r.accessId, clock)).rejects.toMatchObject({ status: 404 });
  });
});
