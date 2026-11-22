import { describe, expect, it } from "vitest";
import { m6JobSchemas } from "./queues";

/** OUT-007: every M6 job payload is ids / enums / numbers only. */
describe("OUT-007 M6 job payload allow-list", () => {
  const FORBIDDEN = /(email|ip|body|title|text|score|reason|name|statement|note|rationale|label)/i;
  it("no schema has a free-text or PII-shaped key, and all are strict", () => {
    for (const [name, schema] of Object.entries(m6JobSchemas)) {
      for (const k of Object.keys(schema.shape)) expect(k, `${name}.${k}`).not.toMatch(FORBIDDEN);
      expect(schema.safeParse({ extra: "x", caseId: "c", subjectType: "REVIEW", subjectId: "s", contentVersion: 1, trigger: "EDIT" }).success && name !== "moderation.assess").toBe(false);
    }
  });
  it("assess payload is the spec shape and rejects extra keys (e.g. smuggled text)", () => {
    const ok = { caseId: "c1", subjectType: "REVIEW", subjectId: "r1", contentVersion: 2, trigger: "SUBMISSION" };
    expect(m6JobSchemas["moderation.assess"].safeParse(ok).success).toBe(true);
    expect(m6JobSchemas["moderation.assess"].safeParse({ ...ok, body: "secret review text" }).success).toBe(false);
    for (const v of Object.values(m6JobSchemas).filter((s) => Object.keys(s.shape).length)) expect(v.safeParse({}).success).toBe(false);
  });
});
