import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import sharp from "sharp";
import { FakeMailProvider, FakeObjectStore, QUEUES, parseOrderRefKeys } from "@rp/core";
import { SECURITY_ALERT_COPY, sendSecurityAlertEmail, type SecurityAlertDb } from "./email";
import { routes } from "./outbox";
import { failClosedRedactor, processProofFile, purgeProofFiles, sendProofNotice, sweepProofs, type ProofDeps } from "./proofs";
import { makeFakeDb } from "./test-fake-db";

// Close-out pack (task #75): SEC-M3B-01, RPT-005, PRV-007, PRV-023 (QA-M4-02 / QA-M4-03).
const NOW = new Date("2026-12-10T12:00:00Z");
const src = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("SEC-M3B-01 auth.security_alert consumer", () => {
  const db = (user: { email: string; status?: string } | null): SecurityAlertDb => ({ user: { findUnique: vi.fn(async () => user) } });
  it("SEC-M3B-01: every alert kind the web app emits is mailed once, to the account address, with fixed text", async () => {
    const lines = readFileSync(join(__dirname, "../../web/src/server/two-factor.ts"), "utf8").split("\n").filter((l) => /alertEvent\(|auth\.security_alert/.test(l) && /kind: /.test(l));
    const emitted = lines.flatMap((l) => [...l.slice(l.indexOf("kind: ")).matchAll(/"([A-Z]+(?:_[A-Z]+)+)"/g)].map((m) => m[1]!));
    expect(new Set(emitted).size).toBeGreaterThanOrEqual(6);
    for (const kind of new Set(emitted)) {
      expect(SECURITY_ALERT_COPY[kind], kind).toBeDefined();
      const mail = new FakeMailProvider();
      expect(await sendSecurityAlertEmail({ db: db({ email: "u@x.io", status: "ACTIVE" }), mail, baseUrl: "https://app.test" }, { userId: "u1", kind, remaining: 3 }, `job-${kind}`)).toBe("SENT");
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]!.to).toBe("u@x.io");
      expect(mail.sent[0]!.subject).toBe(SECURITY_ALERT_COPY[kind]!.headline);
      expect(mail.sent[0]!.text).toContain("https://app.test/account");
    }
  });
  it("SEC-M3B-01: the recovery-code alert shows the remaining count; no mail carries a code or token", async () => {
    const mail = new FakeMailProvider();
    await sendSecurityAlertEmail({ db: db({ email: "u@x.io" }), mail }, { userId: "u1", kind: "RECOVERY_CODE_USED", remaining: 4 }, "j");
    expect(mail.sent[0]!.text).toContain("left: 4");
    expect(mail.sent[0]!.text).not.toMatch(/token=|code=/);
  });
  it("SEC-M3B-01: unknown kinds, missing users and non-active accounts are skipped", async () => {
    const mail = new FakeMailProvider();
    expect(await sendSecurityAlertEmail({ db: db({ email: "u@x.io" }), mail }, { userId: "u1", kind: "BOGUS" }, "j")).toBe("SKIPPED");
    expect(await sendSecurityAlertEmail({ db: db({ email: "u@x.io" }), mail }, { kind: "TWO_FACTOR_DISABLED" }, "j")).toBe("SKIPPED");
    expect(await sendSecurityAlertEmail({ db: db(null), mail }, { userId: "u1", kind: "TWO_FACTOR_DISABLED" }, "j")).toBe("SKIPPED");
    expect(await sendSecurityAlertEmail({ db: db({ email: "u@x.io", status: "SUSPENDED" }), mail }, { userId: "u1", kind: "TWO_FACTOR_DISABLED" }, "j")).toBe("SKIPPED");
    expect(mail.sent).toHaveLength(0);
  });
  it("SEC-M3B-01: the event is routed to notifications and the notifications processor consumes it", () => {
    expect(routes["auth.security_alert"]).toBe(QUEUES.notifications);
    expect(src("processors.ts")).toMatch(/job\.name === "auth\.security_alert"[^\n]*sendSecurityAlertEmail/);
  });
});

describe("RPT-005 CONTENT_REMOVED notice from the review.removed path", () => {
  it("RPT-005: the email carries the reason category and the public reason", async () => {
    const h = makeFakeDb(["enforcementAction", "user"]);
    h.t.enforcementAction!.push({ id: "e1", caseId: "c1", type: "CONTENT_REMOVAL", subjectUserId: "u1", reasonCode: "FAKE_OR_MISLEADING", publicReason: "The review describes a product you did not buy." });
    h.t.user!.push({ id: "u1", email: "author@x.io", status: "ACTIVE" });
    const mail = new FakeMailProvider();
    expect(await sendProofNotice({ db: h.db, mail }, "review.removed", "r1", { caseId: "c1" }, "job1")).toBe("SENT");
    const m = mail.sent[0]!;
    expect(m.to).toBe("author@x.io");
    expect(m.subject).toMatch(/Your review was removed/);
    expect(m.subject).toContain("Reason: fake or misleading.");
    expect(m.subject).toContain("The review describes a product you did not buy.");
    expect(m.text).toContain("did not buy");
  });
  it("RPT-005: no enforcement row, or an inactive author, sends nothing", async () => {
    const h = makeFakeDb(["enforcementAction", "user"]);
    const mail = new FakeMailProvider();
    expect(await sendProofNotice({ db: h.db, mail }, "review.removed", "r1", { caseId: "c1" }, "j")).toBe("SKIPPED");
    h.t.enforcementAction!.push({ id: "e1", caseId: "c1", type: "CONTENT_REMOVAL", subjectUserId: "u1", reasonCode: "SPAM", publicReason: "x" });
    h.t.user!.push({ id: "u1", email: "a@x.io", status: "SUSPENDED" });
    expect(await sendProofNotice({ db: h.db, mail }, "review.removed", "r1", { caseId: "c1" }, "j")).toBe("SKIPPED");
    expect(mail.sent).toHaveLength(0);
  });
});

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: "#fff" } }).png().toBuffer();
function mk() {
  const h = makeFakeDb(["review", "user", "purchaseProof", "purchaseProofFile", "outboxEvent", "trustSignal", "reviewVote", "report"], {
    purchaseProof: (r, t) => ({ files: t.purchaseProofFile!.filter((f) => f.proofId === r.id), review: { createdAt: new Date("2026-11-01"), product: { name: "W" } } }),
    purchaseProofFile: (r, t) => ({ proof: { submittedById: t.purchaseProof!.find((p) => p.id === r.proofId)?.submittedById } }),
  });
  const store = new FakeObjectStore();
  const deps: ProofDeps = { db: h.db, store: store as never, buckets: { ingest: "ingest", private: "private" }, redactor: failClosedRedactor, keys: parseOrderRefKeys("1:c2VjcmV0"), now: () => NOW };
  return { h, store, deps };
}
async function upload(s: ReturnType<typeof mk>) {
  const b = await png();
  s.h.t.purchaseProofFile!.push({ id: "f1", proofId: "pp", ownerId: "u1", kind: "IMAGE", status: "PROCESSING", declaredMime: "image/png", sizeBytes: b.length, storageKey: "in/proof/f1", isRedacted: false });
  await s.store.put("ingest", "in/proof/f1", b);
}

describe("PRV-007 the review's label survives a proof purge", () => {
  const LABEL = { verifiedPurchaseAt: new Date("2026-12-01"), verificationMethod: "RECEIPT_UPLOAD", verifiedProofId: "pp", verifiedBuyer: true, verifiedAt: new Date("2026-12-01") };
  it("PRV-007: purging originals, all files, and the retention sweep leave every label field on the review unchanged", async () => {
    const s = mk();
    s.h.t.review!.push({ id: "r1", authorId: "u1", status: "PUBLISHED", ...LABEL });
    s.h.t.purchaseProof!.push({ id: "pp", reviewId: "r1", submittedById: "u1", status: "VERIFIED", openKey: null, legalHold: false, reviewedAt: new Date("2026-12-01"), retainFilesUntil: new Date("2026-12-02") });
    await upload(s); await processProofFile(s.deps, "f1");
    const before = JSON.stringify(s.h.t.review);
    expect(await purgeProofFiles(s.deps, "pp", "PROOF_ORIGINAL")).toBe("PURGED");
    expect(JSON.stringify(s.h.t.review)).toBe(before);
    await sweepProofs({ db: s.h.db, store: s.store as never, buckets: s.deps.buckets, now: () => NOW });
    expect(await purgeProofFiles(s.deps, "pp", "ALL")).toMatch(/PURGED|NOOP/);
    expect(s.h.t.purchaseProof![0]!.filesPurgedAt).toEqual(NOW);
    expect(JSON.stringify(s.h.t.review)).toBe(before);
    expect(s.h.t.review![0]).toMatchObject({ verifiedBuyer: true, verifiedProofId: "pp", verificationMethod: "RECEIPT_UPLOAD" });
    expect(s.h.t.purchaseProof![0]!.status).toBe("VERIFIED"); // the proof row (the evidence of the decision) stays
  });
  it("PRV-007: the purge code has no write path to the review table", () => {
    const purge = src("proofs.ts").slice(src("proofs.ts").indexOf("export async function purgeProofFiles"), src("proofs.ts").indexOf("// Vote maintenance"));
    expect(purge).not.toMatch(/\.review\.(update|updateMany|upsert)/);
  });
});

describe("PRV-023 redaction runs with no network (media group probe)", () => {
  const restore: Array<() => void> = [];
  afterEach(() => { restore.splice(0).forEach((r) => r()); });
  /** Every way the Node process can open a connection is replaced by a recorder that throws (a sandbox with no network). */
  function blockNetwork() {
    const attempts: string[] = [];
    const trap = (name: string) => () => { attempts.push(name); throw new Error(`network blocked: ${name}`); };
    const spies = [
      vi.spyOn(net.Socket.prototype, "connect").mockImplementation(trap("net.connect")),
      vi.spyOn(dns, "lookup").mockImplementation(trap("dns.lookup") as never),
      vi.spyOn(http, "request").mockImplementation(trap("http.request") as never),
      vi.spyOn(https, "request").mockImplementation(trap("https.request") as never),
      vi.spyOn(globalThis, "fetch").mockImplementation(trap("fetch") as never),
    ];
    restore.push(() => spies.forEach((x) => x.mockRestore()));
    return attempts;
  }
  it("PRV-023: the wired redactor (fail-closed, no OCR adapter ready) fully masks an image and makes zero network attempts", async () => {
    const attempts = blockNetwork();
    const s = mk();
    s.h.t.purchaseProof!.push({ id: "pp", reviewId: "r1", submittedById: "u1", status: "PENDING", openKey: "r1", slaDueAt: new Date("2026-12-12"), legalHold: false });
    await upload(s);
    expect(await processProofFile(s.deps, "f1")).toBe("READY");
    expect(s.h.t.purchaseProofFile!.find((f) => f.isRedacted)).toMatchObject({ status: "READY" });
    expect(s.h.t.purchaseProof![0]!.redactionMode).toBe("FULL_MASK");
    expect(attempts).toEqual([]);
  });
  it("PRV-023: the probe does detect a redactor that reaches for the network", async () => {
    const attempts = blockNetwork();
    const s = mk();
    s.h.t.purchaseProof!.push({ id: "pp", reviewId: "r1", submittedById: "u1", status: "PENDING", openKey: "r1", slaDueAt: new Date("2026-12-12"), legalHold: false });
    await upload(s);
    const leaky = { async redact() { await fetch("https://ocr.example.invalid/"); throw new Error("unreachable"); } };
    await processProofFile({ ...s.deps, redactor: leaky }, "f1").catch(() => undefined);
    expect(attempts).toContain("fetch");
    expect(s.h.t.purchaseProofFile!.some((f) => f.isRedacted && f.status === "READY")).toBe(false); // fails closed
  });
  it("PRV-023: proof files are processed only by the media queue (the group without verification egress), and the redaction path imports no network client", () => {
    expect(routes["proof.file_uploaded"]).toBe(QUEUES.media);
    expect(routes["proof.submitted"]).toBe(QUEUES.media);
    expect(src("proofs.ts")).not.toMatch(/from "(node:)?(https?|net|tls|dns|undici|axios|node-fetch)"|\bfetch\(/);
    // Wiring status (QA-M4-03): the real OCR adapter is not ready, so the fail-closed redactor stays wired.
    expect(src("processors.ts")).toMatch(/redactor: failClosedRedactor/);
  });
});
