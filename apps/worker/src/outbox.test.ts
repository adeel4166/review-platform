import { describe, expect, it, vi } from "vitest";
import { relayOnce, type OutboxRow } from "./outbox";

const rows: OutboxRow[] = [
  { id: 1n, type: "review.submitted", aggregateId: "r1", payload: { subjectType: "REVIEW", subjectId: "r1", version: 1 } },
  { id: 2n, type: "unknown.type", aggregateId: "x", payload: {} },
];

describe("relayOnce", () => {
  it("routes known events with deterministic jobId and marks all processed", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const markPublished = vi.fn().mockResolvedValue(undefined);
    const n = await relayOnce({ fetchUnpublished: async () => rows, markPublished }, { add });
    expect(n).toBe(2);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith("moderation", "review.submitted", rows[0]!.payload, { jobId: "outbox__1" });
    expect(markPublished).toHaveBeenCalledWith([1n, 2n]);
  });

  it("does not mark rows when enqueue fails (retried next pass)", async () => {
    const markPublished = vi.fn();
    await expect(
      relayOnce({ fetchUnpublished: async () => rows, markPublished }, { add: vi.fn().mockRejectedValue(new Error("redis down")) }),
    ).rejects.toThrow("redis down");
    expect(markPublished).not.toHaveBeenCalled();
  });
});
