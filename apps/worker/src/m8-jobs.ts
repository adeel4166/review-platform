import { createS3Store, createLedgerReader, createLedgerWriter, loadRetentionConfig, parseKeyRing, RETENTION_RULES, runRetention, systemClock, type LedgerWriter, type RuleHandlers } from "@rp/core";
import { randomUUID } from "node:crypto";
import { prisma, PrismaClient } from "@rp/db";
import { getMediaDeps } from "./processors";
import { purgeProofFiles } from "./proofs";
import { eraseAccount, purgeMediaObjects } from "./account/erase";
import { archiveAuditRows } from "./maintenance/audit-export";
import { replayDeletions } from "./maintenance/replay-deletions";
import { reencryptTotp } from "./security/totp-reencrypt";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = prisma as any;
const s3 = (prefix: string) => {
  const key = process.env[`${prefix}_ACCESS_KEY_ID`], secret = process.env[`${prefix}_SECRET_ACCESS_KEY`];
  if (!key || !secret) return null;
  const m = process.env.S3_ENDPOINT ?? "";
  return createS3Store({ S3_ENDPOINT: m, S3_REGION: process.env.S3_REGION ?? "auto", S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE === "true", S3_ACCESS_KEY_ID: key, S3_SECRET_ACCESS_KEY: secret });
};
/** ADR-0033 §4: the worker holds a write-only credential for `rp-ledger`. In production a missing ledger refuses the job (purges must be ledgered). */
export function getLedger(): LedgerWriter | undefined {
  const bucket = process.env.S3_BUCKET_LEDGER, store = s3("S3_LEDGER");
  if (!bucket || !store) { if (process.env.NODE_ENV === "production") throw new Error("deletion ledger is not configured"); return undefined; }
  return createLedgerWriter(store, bucket, systemClock, () => randomUUID());
}
const buckets = () => { const m = getMediaDeps(); return { ingest: m.buckets.ingest, private: m.buckets.private, public: process.env.S3_BUCKET_PUBLIC ?? "" }; };

export function retentionHandlers(): RuleHandlers {
  const m = getMediaDeps(); const ledger = getLedger(); const b = buckets();
  const proofDeps = { db, store: m.store, buckets: b, ...(ledger ? { ledger } : {}) };
  const purgeAssets = async (where: Record<string, unknown>) => (await purgeMediaObjects({ db, store: m.store, buckets: b, clock: systemClock, ...(ledger ? { ledger } : {}) }, await db.mediaAsset.findMany({ where }))).purged;
  return {
    "RET-PROOF-ORIG": async (ids) => { let n = 0; for (const id of ids) if ((await purgeProofFiles(proofDeps, id, "PROOF_ORIGINAL")) === "PURGED") n++; return n; },
    "RET-PROOF-RED": async (ids) => { let n = 0; for (const id of ids) if ((await purgeProofFiles(proofDeps, id, "ALL")) === "PURGED") n++; return n; },
    "RET-APPEAL-EVID": (ids) => purgeAssets({ appealId: { in: ids } }),
    "RET-MEDIA-REJ": async (caseIds) => {
      const cases = await db.moderationCase.findMany({ where: { id: { in: caseIds }, status: "RESOLVED", review: { status: { in: ["REJECTED", "REMOVED"] } } } });
      return purgeAssets({ reviewId: { in: cases.map((c: any) => c.reviewId).filter(Boolean) } });
    },
    "RET-CLAIM-EVID": async (ids) => (await db.sellerOwnershipClaim.updateMany({ where: { id: { in: ids } }, data: { evidenceUrl: null } })).count,
    "RET-CONTENT-DEL": async (ids) => {
      let n = 0;
      for (const id of ids) {
        const open = await db.moderationCase.count({ where: { reviewId: id, status: { not: "RESOLVED" } } });
        const held = await db.moderationCase.count({ where: { reviewId: id, legalHold: true } });
        if (open || held) continue; // no open case, no legalHold; tombstone ids stay
        await db.reviewRevision.updateMany({ where: { reviewId: id }, data: { title: "", body: "" } });
        n += (await db.review.updateMany({ where: { id }, data: { title: "", body: "" } })).count;
      }
      return n;
    },
    "RET-LSH": async (reviewIds, cutoff) => {
      const live = await db.review.findMany({ where: { id: { in: reviewIds }, status: { in: ["PUBLISHED", "PENDING", "HIDDEN"] } }, select: { id: true } });
      const keep = new Set(live.map((r: any) => r.id));
      const gone = reviewIds.filter((r) => !keep.has(r));
      return gone.length ? (await db.reviewLshBucket.deleteMany({ where: { reviewId: { in: gone }, createdAt: { lt: cutoff } } })).count : 0;
    },
    "RET-AUDIT": async (ids) => {
      const store = s3("S3_AUDIT_ARCHIVE"), bucket = process.env.S3_BUCKET_AUDIT_ARCHIVE, url = process.env.ARCHIVE_DATABASE_URL;
      if (!store || !bucket || !url) { // not configured: rows stay online (never deleted without an archive), but never silently (SEC-FIN-02, P-6)
        if (process.env.NODE_ENV === "production") console.error(JSON.stringify({ msg: "security.alert", kind: "AUDIT_ARCHIVE_UNCONFIGURED", missing: [!store && "S3_AUDIT_ARCHIVE_*", !bucket && "S3_BUCKET_AUDIT_ARCHIVE", !url && "ARCHIVE_DATABASE_URL"].filter(Boolean) }));
        return 0;
      }
      const archiveDb = new PrismaClient({ datasources: { db: { url } } });
      try { return await archiveAuditRows({ db, archiveDb, store, bucket, clock: systemClock }, ids.map((i) => BigInt(i)) as never); } finally { await archiveDb.$disconnect(); }
    },
  };
}

/** Dispatcher for the maintenance queue (spec §25.2). Returns a loggable summary with counts only. */
export async function runM8Job(name: string, data: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "maintenance.retention": return runRetention(db, systemClock, loadRetentionConfig(), retentionHandlers());
    case "maintenance.audit-export": return (await runRetention(db, systemClock, loadRetentionConfig(), retentionHandlers(), { rules: RETENTION_RULES.filter((r) => r.id === "RET-AUDIT") }))[0];
    case "account.erase": { const m = getMediaDeps(); const ledger = getLedger(); return eraseAccount({ db, store: m.store, buckets: buckets(), clock: systemClock, ...(ledger ? { ledger } : {}) }, String(data.erasureRequestId)); }
    case "maintenance.replay-deletions": {
      const store = s3("S3_LEDGER_READ"), bucket = process.env.S3_BUCKET_LEDGER;
      if (!store || !bucket) throw new Error("ledger reader is not configured");
      const m = getMediaDeps();
      return replayDeletions({ db, store: m.store, reader: createLedgerReader(store, bucket, systemClock), clock: systemClock }, String(data.since));
    }
    case "security.totp-reencrypt": return reencryptTotp({ db, ring: parseKeyRing(process.env.TOTP_ENC_KEYS, process.env.TOTP_ENC_ACTIVE_KEY_ID) });
    default: return "SKIPPED";
  }
}
