import { describe, expect, it } from "vitest";
import { FakeObjectStore } from "../media-store-fake";
import { LedgerListingTruncatedError, createLedgerReader, ledgerDays, toNdjson } from "./ledger";

const entry = (id: string) => ({ objectKey: `k/${id}`, entity: "media", id, purgedAt: "2027-03-01T00:00:00Z" });
const clock = (iso: string) => ({ now: () => new Date(iso) });

describe("SEC-FIN-03 ledger reader", () => {
  it("lists by YYYY-MM-DD/ prefix for every day from since to today (inclusive)", () => {
    expect(ledgerDays("2027-02-27", new Date("2027-03-02T10:00:00Z"))).toEqual(["2027-02-27", "2027-02-28", "2027-03-01", "2027-03-02"]);
    expect(ledgerDays("2027-03-05", new Date("2027-03-02T10:00:00Z"))).toEqual([]);
    expect(() => ledgerDays("../x", new Date())).toThrow(/YYYY-MM-DD/);
  });

  it("reads the NEWEST day even when far more than 10,000 older objects exist (the old whole-bucket 10k cap dropped it)", async () => {
    const store = new FakeObjectStore();
    for (let i = 0; i < 10_500; i++) store.objects.set(`ledger/2027-01-01/${String(i).padStart(6, "0")}.ndjson`, Buffer.from(toNdjson([entry(`old${i}`)])));
    store.objects.set("ledger/2027-03-01/zz.ndjson", Buffer.from(toNdjson([entry("newest")])));
    const out = await createLedgerReader(store, "ledger", clock("2027-03-01T12:00:00Z")).read("2027-02-28");
    expect(out.map((e) => e.id)).toEqual(["newest"]);
  });

  it("paginates a day beyond 1,000 objects (no cap below the ceiling)", async () => {
    const store = new FakeObjectStore();
    for (let i = 0; i < 2_500; i++) store.objects.set(`ledger/2027-03-01/${String(i).padStart(5, "0")}.ndjson`, Buffer.from(toNdjson([entry(`e${i}`)])));
    expect((await createLedgerReader(store, "ledger", clock("2027-03-01T00:00:00Z")).read("2027-03-01")).length).toBe(2_500);
  });

  it("fails the job (does not silently truncate) when a day's listing reaches the ceiling", async () => {
    const store = new FakeObjectStore();
    for (let i = 0; i < 5; i++) store.objects.set(`ledger/2027-03-01/s${i}.ndjson`, Buffer.from(toNdjson([entry(`e${i}`)])));
    await expect(createLedgerReader(store, "ledger", clock("2027-03-01T00:00:00Z"), 5).read("2027-03-01")).rejects.toBeInstanceOf(LedgerListingTruncatedError);
    await expect(createLedgerReader(store, "ledger", clock("2027-03-01T00:00:00Z"), 6).read("2027-03-01")).resolves.toHaveLength(5);
  });
});
