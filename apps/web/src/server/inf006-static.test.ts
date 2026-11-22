import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** INF-002 / INF-006: the web app never reads the ingest bucket (it only presigns PUTs into it). Static check over apps/web/src. */
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) && !/\.test\.ts$/.test(p) ? [p] : []; });

describe("INF-006: web never reads ingest", () => {
  it("no GET/HEAD/List against buckets.ingest in apps/web/src", () => {
    const offenders = walk(path.join(__dirname, "..")).filter((f) => /\.(head|get|presignGet)\(\s*[\w.]*buckets\.ingest/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
