import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAuditMetadataClean, findPiiAuditKeys } from "./audit-metadata";

describe("audit metadata PII guard (SEC-09c)", () => {
  it("accepts ids, enums, counters and reasons", () => {
    expect(() => assertAuditMetadataClean({ caseId: "c1", version: 2, from: "A", to: "B", reason: "spam", jobId: "j" })).not.toThrow();
  });
  it.each(["email", "Email", "ip", "ipAddress", "ip_address", "clientIp", "name", "displayName", "handle", "userAgent", "phone", "x-forwarded-for"])(
    "rejects key %s, also when nested", (k) => {
      expect(findPiiAuditKeys({ [k]: "x" })).toEqual([k]);
      expect(findPiiAuditKeys({ a: [{ [k]: "x" }] })).toEqual([`a[0].${k}`]);
      expect(() => assertAuditMetadataClean({ ok: 1, nested: { [k]: "x" } })).toThrow(/must not contain/);
    });
  it("does not flag look-alike benign keys", () => {
    expect(findPiiAuditKeys({ reviewId: "r", filename: "f", ipfs: 1, hostname: "h" })).toEqual([]);
  });
});

/** Static scan: every `metadata: {...}` / `meta: {...}` literal in non-test source must be free of PII keys. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === ".next" || n === "dist" || n === "coverage") return [];
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
function literalAfter(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(from, i + 1);
  }
  return "";
}

describe("audit metadata literals in source (SEC-09c)", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files = ["apps", "packages"].flatMap((d) => sources(join(root, d)));
  it("scans real files", () => expect(files.length).toBeGreaterThan(20));
  it("no metadata/meta literal contains email, IP or name keys", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\b(?:metadata|meta)\s*:\s*(?=\{)/g)) {
        const lit = literalAfter(src, m.index! + m[0].length);
        for (const k of lit.matchAll(/(?:^|[{,]\s*)["']?([A-Za-z_][\w-]*)["']?\s*:/g)) {
          if (findPiiAuditKeys({ [k[1]!]: 1 }).length) offenders.push(`${f.replace(root, "")}: ${k[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
