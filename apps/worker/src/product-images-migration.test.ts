import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../../../packages/db/prisma/migrations/20270401000000_product_images/", import.meta.url);
const up = readFileSync(new URL("migration.sql", dir), "utf8");
const down = readFileSync(new URL("down.sql", dir), "utf8");
const schema = readFileSync(new URL("../../../packages/db/prisma/schema.prisma", import.meta.url), "utf8");

describe("V3-04 migration is reversible and matches ADR-0034 D11", () => {
  it("creates product_images with the CHECKs, generated primary column and unique index", () => {
    for (const c of ["chk_media_purpose_owner", "chk_product_images_position", "chk_product_images_alt", "chk_product_images_published", "chk_product_images_color"]) expect(up).toContain(c);
    expect(up).toMatch(/`primaryProductId` VARCHAR\(191\) GENERATED ALWAYS AS \(CASE WHEN `isPrimary` THEN `productId` END\) STORED/);
    expect(up).toContain("UNIQUE INDEX `product_images_primaryProductId_key`");
    expect(up).toMatch(/`alt` VARCHAR\(250\) NOT NULL/);
  });
  it("down.sql undoes every up step in reverse", () => {
    expect(down).toContain("DROP TABLE `product_images`");
    expect(down).toContain("DROP CHECK `chk_media_purpose_owner`");
    expect(down).toContain("MODIFY `reviewId` VARCHAR(191) NOT NULL");
    expect(down).toContain("DROP COLUMN `purpose`");
    expect(down.indexOf("DROP TABLE")).toBeLessThan(down.indexOf("DELETE FROM `media_assets`")); // FK first
    expect(down.indexOf("DELETE FROM `media_assets`")).toBeLessThan(down.indexOf("MODIFY `reviewId`")); // no NULL reviewId left
  });
  it("schema.prisma mirrors the migration (alt required, one primary column, nullable reviewId)", () => {
    expect(schema).toMatch(/model ProductImage[\s\S]*alt\s+String\s+@db\.VarChar\(250\)/);
    expect(schema).toMatch(/primaryProductId String\? @unique/);
    expect(schema).toMatch(/reviewId\s+String\?\n\s+purpose\s+MediaPurpose/);
  });
});
