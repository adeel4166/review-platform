import type { Job } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUEUES, mediaJobSchema } from "@rp/core";
import { processors } from "./processors";

vi.mock("@rp/db", () => ({ prisma: {} }));
vi.mock("./moderation", () => ({ processModeration: vi.fn(async () => "SKIPPED") }));

/** SMK-003: worker smoke. Skeleton processors must validate payloads and fail closed. */
const job = (data: unknown) => ({ id: "j1", data }) as unknown as Job;

describe("worker processors (smoke, SMK-003)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers exactly the queues with validated skeleton processors", () => {
    expect(Object.keys(processors).sort()).toEqual([QUEUES.media, QUEUES.moderation, QUEUES.notifications].sort());
  });

  it("accepts a valid moderation payload", async () => {
    await expect(
      processors[QUEUES.moderation]!(job({ subjectType: "REVIEW", subjectId: "r1", version: 1 })),
    ).resolves.toBeUndefined();
  });

  it("rejects a malformed moderation payload instead of approving it", async () => {
    await expect(
      processors[QUEUES.moderation]!(job({ subjectType: "NOPE", subjectId: "r1", version: 1 })),
    ).rejects.toThrow();
  });

  it("accepts a valid media payload and defaults the step to VALIDATE (processing: media.test.ts)", () => {
    expect(mediaJobSchema.parse({ assetId: "a1" }).step).toBe("VALIDATE");
  });

  it("rejects a media payload with an unknown step", async () => {
    await expect(processors[QUEUES.media]!(job({ assetId: "a1", step: "PUBLISH" }))).rejects.toThrow();
  });
});
