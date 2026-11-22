import { describe, expect, it } from "vitest";

/**
 * QA-M6-04: runs only in the CI `mysql-int` job (RP_INT_MYSQL=1, a migrated MySQL 8 at DATABASE_URL). It asserts the database
 * guarantees the in-memory suites (MOD-020/021, TMR-014, VOT-003, RPT-004, retention/erasure) rely on actually exist in real MySQL.
 */
const on = process.env.RP_INT_MYSQL === "1";

describe.skipIf(!on)("real MySQL: migrated schema guarantees", () => {
  const q = async <T>(sql: string, ...args: unknown[]): Promise<T[]> => {
    const { prisma } = await import("@rp/db");
    return (await prisma.$queryRawUnsafe(sql, ...args)) as T[];
  };
  const uniqueCols = async (table: string) =>
    (await q<{ idx: string; cols: string }>(
      "SELECT INDEX_NAME AS idx, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0 GROUP BY INDEX_NAME", table,
    )).map((r) => r.cols);

  it("MED-037: chk_media_public_bucket CHECK is enforced by MySQL", async () => {
    const r = await q<{ n: bigint | number }>("SELECT COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_media_public_bucket'");
    expect(Number(r[0]?.n)).toBe(1);
  });
  it("MOD-020/021: one open case per target (moderation_cases.openKey unique)", async () => {
    expect(await uniqueCols("moderation_cases")).toContain("openKey");
  });
  it("RPT-004: a reporter can report a review once (unique reporterId+reviewId)", async () => {
    expect(await uniqueCols("reports")).toContain("reporterId,reviewId");
  });
  it("VOT-003: one vote per user per review", async () => {
    const t = await q<{ t: string }>("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'review_votes'");
    expect(t.length).toBe(1);
    const cols = await uniqueCols("review_votes");
    expect(cols.some((c) => /userId/.test(c) && /reviewId/.test(c))).toBe(true);
  });
  it("TMR-014: the server clock and column precision agree (UTC session, DATETIME(3) timers)", async () => {
    const r = await q<{ tz: string }>("SELECT @@global.time_zone AS tz");
    expect(["+00:00", "SYSTEM", "UTC"]).toContain(r[0]?.tz);
    const c = await q<{ p: bigint | number }>("SELECT DATETIME_PRECISION AS p FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'moderation_cases' AND COLUMN_NAME = 'holdExpiresAt'");
    expect(Number(c[0]?.p)).toBe(3);
  });
  it("retention/erasure: users table present with the soft-delete/erasure status column", async () => {
    const c = await q<{ n: bigint | number }>("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'");
    expect(Number(c[0]?.n)).toBe(1);
  });
});
