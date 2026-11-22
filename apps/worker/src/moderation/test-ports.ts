import { MemoryStore } from "@rp/core/testing";
import type { CaseRec } from "@rp/core";
import type { AssessPort, AssessSubject } from "./assess";
import type { SweepCase, SweepPort } from "./sweep";

/** Test helper: ports over the core MemoryStore so the worker logic runs against the same conditional-update semantics. */
export interface MemCase { createdAt: Date; targetId: string; media: AssessSubject["media"]; kind: "CONTENT" | "REVISION" }
export class MemPorts implements SweepPort, AssessPort {
  extra = new Map<string, MemCase>();
  breached = new Set<string>();
  appeals: { id: string; slaDueAt: Date; priority: number }[] = [];
  strikes: { caseId: string; userId: string; transition: string }[] = [];
  issued: string[] = [];
  pendingApprovals: { id: string; expiresAt: Date }[] = [];
  subjects = new Map<string, Partial<AssessSubject>>();
  constructor(public store: MemoryStore) {}
  track(c: CaseRec, m: MemCase) { this.extra.set(c.id, m); }
  async openCases(limit: number, after?: string): Promise<SweepCase[]> {
    return [...this.store.cases.values()].filter((c) => c.status !== "RESOLVED" && c.status !== undefined && (!after || c.id > after)).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, limit).map((c) => {
      const x = this.extra.get(c.id)!;
      const t = this.store.targets.get(`REVIEW:${x.targetId}`)!;
      return { caseId: c.id, target: { type: "REVIEW", id: x.targetId }, kind: x.kind, status: c.status as "OPEN", lane: c.lane, createdAt: x.createdAt, holdExpiresAt: c.holdExpiresAt, postReviewDueAt: c.postReviewDueAt, postReviewBreachedAt: this.breached.has(c.id) ? new Date(0) : null, slaDueAt: c.slaDueAt, priority: c.priority, hasPendingMedia: x.media === "PENDING", targetStatus: t.status, contentVersion: c.version };
    });
  }
  async markPostReviewBreached(id: string) { if (this.breached.has(id)) return false; this.breached.add(id); this.store.cases.get(id)!.priority += 100; return true; }
  async bumpOnce(id: string, by: number) { const c = this.store.cases.get(id)!; if (c.priority >= by) return false; c.priority += by; return true; }
  async openAppeals() { return this.appeals; }
  async bumpAppealOnce(id: string, by: number) { const a = this.appeals.find((x) => x.id === id)!; if (a.priority >= by) return false; a.priority += by; return true; }
  async closedWindowStrikes() { return this.strikes.filter((s) => !this.issued.includes(s.caseId)); }
  async issueDeferredStrike(caseId: string) { if (this.issued.includes(caseId)) return false; this.issued.push(caseId); return true; }
  async expirePendingApprovals(now: Date) { const n = this.pendingApprovals.filter((a) => a.expiresAt <= now).length; this.pendingApprovals = this.pendingApprovals.filter((a) => a.expiresAt > now); return n; }
  async load(caseId: string): Promise<AssessSubject | null> {
    const c = this.store.cases.get(caseId); const x = this.extra.get(caseId);
    if (!c || !x) return null;
    const t = this.store.targets.get(`REVIEW:${x.targetId}`)!;
    return { caseId, target: { type: "REVIEW", id: x.targetId }, caseVersion: c.version, targetVersion: t.version, targetStatus: t.status, kind: x.kind, caseCreatedAt: x.createdAt, caseResolved: c.status === "RESOLVED", lane: c.lane,
      content: { title: "t", body: "a perfectly fine review", rating: 4 }, trustBand: "MEDIUM", contentType: "REVIEW", media: x.media, hasExternalLink: false, productReviewsLastHour: 0, resubmitAfterHuman: false, unsupportedLanguage: false, ruleHits: [], rescanCount: 0, priorDecisionsAllAiUnavailable: true, hasHumanDecision: false, ...this.subjects.get(caseId) };
  }
}
