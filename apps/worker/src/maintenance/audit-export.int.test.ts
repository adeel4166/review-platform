import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeObjectStore } from "@rp/core";
import { FakeClock } from "@rp/core/testing";
import { makeFakeDb } from "../test-fake-db";
import { archiveAuditRows, manifestKey, type Manifest } from "./audit-export";

describe("OPS-007 audit archive export", () => {
  it("writes a hashed segment and a daily manifest, then deletes with the archive role", async () => {
    const app = makeFakeDb(["auditLog"]); const archive = makeFakeDb(["auditLog"]);
    app.t.auditLog!.push(...[1, 2, 3].map((i) => ({ id: i, actorType: "STAFF", action: "x", entityType: "E", entityId: String(i), createdAt: new Date("2025-01-01") })));
    archive.t.auditLog = app.t.auditLog!; // same rows, different role
    const store = new FakeObjectStore(); const clock = new FakeClock("2027-03-01T04:00:00Z");
    const n = await archiveAuditRows({ db: app.db, archiveDb: { auditLog: { deleteMany: async ({ where }: { where: { id: { in: number[] } } }) => { app.t.auditLog = app.t.auditLog!.filter((r) => !where.id.in.includes(r.id as number)); return { count: 0 }; } } }, store, bucket: "rp-audit-archive", clock }, ["1", "2", "3"].map(Number) as never);
    expect(n).toBe(3);
    expect(app.t.auditLog).toHaveLength(0);
    const m = JSON.parse((await store.get("rp-audit-archive", manifestKey("2027-03-01"), 1e6))!.toString()) as Manifest;
    expect(m.segments).toHaveLength(1);
    const seg = (await store.get("rp-audit-archive", m.segments[0]!.key, 1e6))!;
    expect(createHash("sha256").update(seg).digest("hex")).toBe(m.segments[0]!.sha256);
    expect(m.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("keeps the rows when the archived object fails read-back verification", async () => {
    const app = makeFakeDb(["auditLog"]);
    app.t.auditLog!.push({ id: 1, createdAt: new Date("2025-01-01") });
    const store = new FakeObjectStore(); store.get = async () => Buffer.from("corrupt");
    let deleted = 0;
    await expect(archiveAuditRows({ db: app.db, archiveDb: { auditLog: { deleteMany: async () => { deleted++; } } }, store, bucket: "b", clock: new FakeClock() }, [1] as never)).rejects.toThrow(/verification/);
    expect(deleted).toBe(0);
  });
});
