import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "@rp/core";

const root = join(__dirname, "..", "..", "..");
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    if (["node_modules", ".next", "coverage", "dist", ".git"].includes(n)) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const rel = (f: string) => relative(root, f).split("\\").join("/");

describe("SCOPE-001 no messaging in Phase 1 (re-run for M7)", () => {
  it("has no permission matching ^message\\.", () => {
    const files = walk(join(root, "packages")).filter((f) => /\/authz\//.test(f) && f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/["'`]message\.[a-z_.]+["'`]/);
  });
  it("has no route file path matching /messag|conversation|/dm|inbox/thread/", () => {
    const routes = walk(join(root, "apps", "web", "src", "app")).filter((f) => /(route|page)\.tsx?$/.test(f)).map(rel);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => /messag|conversation|\/dm\b|inbox\/thread/i.test(r))).toEqual([]);
  });
  it("has no Prisma model or @@map matching /message|conversation|thread/", () => {
    const schema = readFileSync(join(root, "packages", "db", "prisma", "schema.prisma"), "utf8");
    const bad = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]!).concat([...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]!));
    expect(bad.filter((n) => /message|conversation|thread/i.test(n))).toEqual([]);
  });
  it("has no NotificationType starting with MESSAGE (code and schema)", () => {
    expect(NOTIFICATION_TYPES.filter((t) => t.startsWith("MESSAGE"))).toEqual([]);
    const schema = readFileSync(join(root, "packages", "db", "prisma", "schema.prisma"), "utf8");
    const block = /enum NotificationType \{([^}]*)\}/.exec(schema)?.[1] ?? "";
    expect(block).not.toMatch(/^\s*MESSAGE/m);
  });
  it("has no message compose/send UI key or message-button test id in the web sources", () => {
    const src = walk(join(root, "apps", "web", "src")).filter((f) => /\.(tsx?|json)$/.test(f) && !f.endsWith("scope.test.ts"));
    for (const f of src) {
      const t = readFileSync(f, "utf8");
      expect(t, rel(f)).not.toMatch(/message\.(send|compose)|\.message_button|data-testid=["']message-button/);
    }
  });
});
