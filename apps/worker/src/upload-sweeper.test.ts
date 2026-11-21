import { describe, expect, it } from "vitest";
import { FakeObjectStore, MEDIA_PUT_TTL_SECONDS } from "@rp/core";
import { expireStaleUploads, type MediaDb } from "./media";

type Row = { id: string; status: string; createdAt: Date; ingestKey: string; failureReason?: string };
const now = new Date("2026-01-01T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);

function setup(rows: Row[]) {
  const db: MediaDb = {
    mediaAsset: {
      findUnique: async () => null,
      findMany: async (args) => {
        const w = (args as { where: { status: string; createdAt: { lt: Date } } }).where;
        return rows.filter((r) => r.status === w.status && r.createdAt < w.createdAt.lt);
      },
      updateMany: async (args) => {
        const { where, data } = args as { where: { id: { in: string[] }; status: string; createdAt: { lt: Date } }; data: Partial<Row> };
        const hit = rows.filter((r) => where.id.in.includes(r.id) && r.status === where.status && r.createdAt < where.createdAt.lt);
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
  };
  const store = new FakeObjectStore();
  return { db, store, deps: { db, store, buckets: { ingest: "ingest", private: "private" } } };
}

describe("expireStaleUploads (SEC-03)", () => {
  it("expires UPLOADING slots older than the presign TTL only", async () => {
    const rows: Row[] = [
      { id: "old", status: "UPLOADING", createdAt: ago(MEDIA_PUT_TTL_SECONDS + 1), ingestKey: "in/old" },
      { id: "fresh", status: "UPLOADING", createdAt: ago(MEDIA_PUT_TTL_SECONDS - 5), ingestKey: "in/fresh" },
      { id: "proc", status: "PROCESSING", createdAt: ago(99999), ingestKey: "in/proc" },
      { id: "ready", status: "READY", createdAt: ago(99999), ingestKey: "in/ready" },
    ];
    const { deps } = setup(rows);
    expect(await expireStaleUploads(deps, MEDIA_PUT_TTL_SECONDS, now)).toBe(1);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.old).toMatchObject({ status: "FAILED", failureReason: "UPLOAD_EXPIRED" });
    expect(by.fresh!.status).toBe("UPLOADING");
    expect(by.proc!.status).toBe("PROCESSING");
    expect(by.ready!.status).toBe("READY");
  });
  it("is idempotent and a no-op when nothing is stale", async () => {
    const rows: Row[] = [{ id: "old", status: "UPLOADING", createdAt: ago(5000), ingestKey: "in/old" }];
    const { deps } = setup(rows);
    expect(await expireStaleUploads(deps, MEDIA_PUT_TTL_SECONDS, now)).toBe(1);
    expect(await expireStaleUploads(deps, MEDIA_PUT_TTL_SECONDS, now)).toBe(0);
  });
});
