import { ApiError, api } from "./upload";

export type CaseState = "PENDING" | "AI_REVIEW" | "NEEDS_HUMAN" | "APPROVED" | "REJECTED";
export const CASE_STATES: CaseState[] = ["NEEDS_HUMAN", "AI_REVIEW", "PENDING", "APPROVED", "REJECTED"];

export interface QueueItem {
  id: string;
  state: CaseState;
  aiScore: string | number | null;
  aiConfidence: string | number | null;
  aiReasons: unknown;
  aiProvider: string | null;
  decisionReason: string | null;
  createdAt: string;
  subjectType?: "REVIEW" | "SELLER_REPLY";
  /** Null for SELLER_REPLY cases (ADR-0021): the text to moderate is in `sellerReply`. */
  review: { id: string; rating: number; title: string; body: string; verifiedBuyer: boolean; author: { handle: string }; _count?: { media: number } } | null;
  sellerReply?: { id: string; sellerId: string; reviewId: string; body: string; version: number } | null;
}
export interface QueuePage { items: QueueItem[]; page: number; pageSize: number; total: number }
export interface CaseMedia { id: string; status: string; width: number | null; height: number | null; failureReason: string | null; thumbUrl: string | null; mediumUrl: string | null }
type ReviewPart = NonNullable<QueueItem["review"]>;
export interface CaseDetail extends Omit<QueueItem, "review"> { review: (Omit<ReviewPart, "_count"> & { media: CaseMedia[] }) | null }
export interface AuditItem { id: string; actorType: string; actorId: string | null; action: string; entityType: string; entityId: string; metadata: unknown; createdAt: string }

export interface Filters { subjectType: "REVIEW" | "SELLER_REPLY"; state: CaseState; minScore: string; maxScore: string; hasMedia: "any" | "true" | "false"; page: number }
export const defaultFilters: Filters = { subjectType: "REVIEW", state: "NEEDS_HUMAN", minScore: "", maxScore: "", hasMedia: "any", page: 1 };

export function queueQueryString(f: Filters): string {
  const p = new URLSearchParams({ state: f.state, page: String(f.page), pageSize: "20" });
  if (f.subjectType !== "REVIEW") p.set("subjectType", f.subjectType); // server default is REVIEW
  const num = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1;
  if (num(f.minScore)) p.set("minScore", f.minScore.trim());
  if (num(f.maxScore)) p.set("maxScore", f.maxScore.trim());
  if (f.hasMedia !== "any") p.set("hasMedia", f.hasMedia);
  return p.toString();
}

export const MIN_REJECT_REASON = 3;

/** Client-side check mirroring rejectInput (server stays authoritative). Returns an i18n key or null. */
export function validateReject(reason: string): "mod.err.reasonRequired" | null {
  return reason.trim().length >= MIN_REJECT_REASON ? null : "mod.err.reasonRequired";
}

export type DecisionResult = { ok: true; id: string; state: "APPROVED" | "REJECTED" } | { ok: false; errorKey: "mod.err.reasonRequired" | "mod.err.conflict" | "mod.err.forbidden" | "mod.err.generic" };

export function errorKeyForStatus(status: number): "mod.err.conflict" | "mod.err.forbidden" | "mod.err.generic" {
  return status === 409 || status === 404 ? "mod.err.conflict" : status === 401 || status === 403 ? "mod.err.forbidden" : "mod.err.generic";
}

/** Approve or reject one case. `call` is injectable for tests. */
export async function decide(
  id: string, action: "approve" | "reject", reason: string,
  call: <T>(path: string, init?: RequestInit) => Promise<T> = api,
): Promise<DecisionResult> {
  if (action === "reject" && validateReject(reason)) return { ok: false, errorKey: "mod.err.reasonRequired" };
  const body = reason.trim() ? { reason: reason.trim() } : {};
  try {
    const r = await call<{ id: string; state: "APPROVED" | "REJECTED" }>(`/api/admin/moderation/${encodeURIComponent(id)}/${action}`, { method: "POST", body: JSON.stringify(body) });
    return { ok: true, id: r.id, state: r.state };
  } catch (e) {
    return { ok: false, errorKey: e instanceof ApiError ? errorKeyForStatus(e.status) : "mod.err.generic" };
  }
}

/** Optimistic-free queue update: drop a decided case and adjust the total (no reload). */
export function removeCase(page: QueuePage, id: string): QueuePage {
  const items = page.items.filter((i) => i.id !== id);
  return items.length === page.items.length ? page : { ...page, items, total: Math.max(0, page.total - 1) };
}

/** Normalises aiReasons (unknown JSON) to display strings. */
export function reasonList(reasons: unknown): string[] {
  if (!Array.isArray(reasons)) return [];
  return reasons.map((r) => (typeof r === "string" ? r : r && typeof r === "object" ? String((r as Record<string, unknown>).label ?? (r as Record<string, unknown>).reason ?? (r as Record<string, unknown>).code ?? JSON.stringify(r)) : String(r)));
}

export const formatScore = (s: string | number | null): string => (s === null || s === undefined || Number.isNaN(Number(s)) ? "—" : Number(s).toFixed(2));
