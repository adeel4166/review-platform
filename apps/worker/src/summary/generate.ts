/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { SUMMARY_DEBOUNCE_MS, SUMMARY_MAX_INPUT_REVIEWS, SUMMARY_MIN_REVIEWS, SUMMARY_PROMPT_SHA256, generateSummary, type Clock, type GenerateDeps, type SummaryReviewInput } from "@rp/core";

/** V3-06: `review.summary_requested` (debounce) and `summary.generate` (ADR-0034 D12). Logs carry ids and reason codes only, never review text or keys. */

export type Enqueue = (name: string, data: unknown, opts: Record<string, unknown>) => Promise<unknown>;
export interface SummaryJobDeps {
  db: any;
  clock: Clock;
  enabled: boolean;
  /** Absent when no real provider is configured: the job is skipped, never faked. */
  gen?: Omit<GenerateDeps, "sleep"> & { sleep?: GenerateDeps["sleep"] };
  model: string;
  enqueue?: Enqueue;
  debounceMs?: number;
}
export type SummaryOutcome = "disabled" | "no_provider" | "no_review" | "scheduled" | "insufficient" | "unchanged" | "saved" | "hidden" | "failed";

/** Thrown for a retryable provider failure so BullMQ retries the job with its own backoff. The message is a reason code only. */
export class SummaryRetryError extends Error { constructor(reason: string) { super(`summary_retry:${reason}`); } }

/** Debounce: a deterministic jobId means a burst of approvals collapses into ONE delayed generation per (product, language). */
export async function scheduleSummary(d: SummaryJobDeps, reviewId: string, language = "en"): Promise<SummaryOutcome> {
  if (!d.enabled) return "disabled";
  const r = await d.db.review.findUnique({ where: { id: reviewId }, select: { productId: true } });
  if (!r || !d.enqueue) return "no_review";
  await d.enqueue("summary.generate", { productId: r.productId, language }, { jobId: `summary__${r.productId}__${language}`, delay: d.debounceMs ?? SUMMARY_DEBOUNCE_MS, removeOnComplete: true, attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
  return "scheduled";
}

/** 25 most helpful + 25 most recent, de-duplicated (ADR-0034 D12). */
export function pickInput<T extends { id: string; helpfulWeighted: unknown; publishedAt: Date | null }>(rows: readonly T[]): T[] {
  const half = SUMMARY_MAX_INPUT_REVIEWS / 2;
  const helpful = [...rows].sort((a, b) => Number(b.helpfulWeighted) - Number(a.helpfulWeighted) || a.id.localeCompare(b.id)).slice(0, half);
  const recent = [...rows].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || a.id.localeCompare(b.id)).slice(0, half);
  return [...new Map([...helpful, ...recent].map((r) => [r.id, r])).values()];
}

export async function runSummaryJob(d: SummaryJobDeps, productId: string, language = "en"): Promise<SummaryOutcome> {
  if (!d.enabled) return "disabled";
  const rows: any[] = await d.db.review.findMany({
    where: { productId, status: "PUBLISHED", deletedAt: null, aggregateExcludedAt: null, OR: [{ language: null }, { language }] },
    select: { id: true, rating: true, title: true, body: true, verifiedBuyer: true, publishedVersion: true, helpfulWeighted: true, publishedAt: true },
  });
  const existing = await d.db.productReviewSummary.findUnique({ where: { productId_language: { productId, language } } });
  const now = d.clock.now();
  if (rows.length < SUMMARY_MIN_REVIEWS) { // fewer than 5 approved reviews: no summary (a previous one is hidden, never shown stale)
    if (existing && existing.status === "READY") { await d.db.productReviewSummary.update({ where: { id: existing.id }, data: { status: "HIDDEN", hiddenAt: now, hiddenReason: "SOURCE_REMOVED" } }); return "hidden"; }
    return "insufficient";
  }
  if (!d.gen) return "no_provider";
  const picked = pickInput(rows);
  const inputHash = createHash("sha256").update(picked.map((r) => `${r.id}:${r.publishedVersion ?? 0}`).sort().join("|")).digest("hex");
  if (existing?.status === "READY" && existing.inputHash === inputHash) return "unchanged";

  const input: SummaryReviewInput[] = picked.map((r) => ({ id: r.id, rating: r.rating, title: r.title, body: r.body, verified: !!r.verifiedBuyer }));
  const res = await generateSummary({ ...d.gen, sleep: d.gen.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))) }, input);
  if (!res.ok) {
    console.warn(JSON.stringify({ msg: "summary.failed", productId, reason: res.reason, retryable: res.retryable }));
    if (res.retryable) throw new SummaryRetryError(res.reason); // the previous READY row stays visible
    if (existing && res.reason === "injection") { await d.db.productReviewSummary.update({ where: { id: existing.id }, data: { status: "HIDDEN", hiddenAt: now, hiddenReason: "INJECTION_CANARY" } }); return "hidden"; }
    if (!existing) await d.db.productReviewSummary.create({ data: { productId, language, status: "FAILED", pros: [], cons: [], summary: "", sourceReviewCount: picked.length, sourceReviewIds: picked.map((r) => r.id), inputHash, model: d.model.slice(0, 64), promptSha256: SUMMARY_PROMPT_SHA256, generatedAt: now } });
    return "failed";
  }
  const data = { status: "READY", pros: res.summary.pros, cons: res.summary.cons, summary: res.summary.overview, sourceReviewCount: picked.length, sourceReviewIds: picked.map((r) => r.id), inputHash, model: d.model.slice(0, 64), promptSha256: SUMMARY_PROMPT_SHA256, generatedAt: now, hiddenAt: null, hiddenReason: null, hiddenById: null };
  await d.db.productReviewSummary.upsert({ where: { productId_language: { productId, language } }, create: { productId, language, ...data }, update: data });
  console.log(JSON.stringify({ msg: "summary.saved", productId, sourceReviewCount: picked.length }));
  return "saved";
}
