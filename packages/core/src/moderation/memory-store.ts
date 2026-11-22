import type { AuditRec, CaseGuard, CasePatch, CaseRec, DecisionRec, OutboxRec, Store, Target, TargetRec, TxStore } from "./transition";
import type { Clock } from "../clock";

/** In-memory Store with transaction rollback and fault injection (MOD-020). Test/dev helper; mirrors the conditional-update semantics of the SQL adapter. */
export class MemoryStore implements Store {
  targets = new Map<string, TargetRec>();
  cases = new Map<string, CaseRec>();
  decisions: DecisionRec[] = [];
  audits: AuditRec[] = [];
  outbox: OutboxRec[] = [];
  openAppeals = new Set<string>();
  /** Throws when this write is reached, to prove the whole transaction rolls back. */
  failOn: "insertDecision" | "insertAudit" | "insertOutbox" | "patchCase" | null = null;
  constructor(private clock?: Clock) {}
  private key = (t: Target) => `${t.type}:${t.id}`;
  addTarget(t: TargetRec) { this.targets.set(this.key(t), { ...t }); }
  addCase(c: Partial<CaseRec> & { id: string }): CaseRec {
    const rec: CaseRec = { status: "OPEN", lane: null, version: 1, assignedToId: null, leaseExpiresAt: null, holdExpiresAt: null, postReviewDueAt: null, slaDueAt: null, appealableUntil: null, resolutionCode: null, legalHold: false, priority: 0, openKey: null, humanDeciderIds: [], rescanCount: 0, ...c };
    this.cases.set(rec.id, rec);
    return rec;
  }
  async transaction<T>(fn: (tx: TxStore) => Promise<T>): Promise<T> {
    const snap = { t: structuredClone(this.targets), c: structuredClone(this.cases), d: structuredClone(this.decisions), a: structuredClone(this.audits), o: structuredClone(this.outbox) };
    let ok = false;
    try {
      const r = await fn(this.tx());
      ok = true;
      return r;
    } finally {
      // A "not applied" result also leaves no writes (the engine only writes after all guards pass), but restore on throw.
      if (!ok) { this.targets = snap.t; this.cases = snap.c; this.decisions = snap.d; this.audits = snap.a; this.outbox = snap.o; }
    }
  }
  private fault(w: NonNullable<MemoryStore["failOn"]>) { if (this.failOn === w) throw new Error(`injected_fault:${w}`); }
  private tx(): TxStore {
    return {
      getTarget: async (t) => this.targets.get(this.key(t)) ?? null,
      getCase: async (id) => this.cases.get(id) ?? null,
      setTargetStatus: async (t, _k, from, to, v) => {
        const cur = this.targets.get(this.key(t));
        if (!cur || !from.includes(cur.status) || (v !== undefined && cur.version !== v)) return false;
        cur.status = to;
        return true;
      },
      patchCase: async (id, g: CaseGuard, patch: CasePatch) => {
        this.fault("patchCase");
        const c = this.cases.get(id);
        if (!c) return false;
        if (g.notResolved && c.status === "RESOLVED") return false;
        if (g.lane && c.lane !== g.lane) return false;
        if (g.assignedToId && c.assignedToId !== g.assignedToId) return false;
        if (g.leaseAfter && !(c.leaseExpiresAt && c.leaseExpiresAt.getTime() > g.leaseAfter.getTime())) return false;
        Object.assign(c, patch);
        return true;
      },
      insertDecision: async (d) => { this.fault("insertDecision"); const id = `dec${this.decisions.length + 1}`; this.decisions.push({ ...d, id }); return id; },
      insertAudit: async (a) => { this.fault("insertAudit"); this.audits.push(a); },
      insertOutbox: async (o) => { this.fault("insertOutbox"); this.outbox.push(o); },
      supersedeOtherOpenCases: async (t, except, now) => {
        let n = 0;
        for (const c of this.cases.values()) if (c.id !== except && c.status !== "RESOLVED" && c.openKey?.includes(`:${t.id}`)) { Object.assign(c, { status: "RESOLVED", resolutionCode: "SUPERSEDED", openKey: null }); void now; n++; }
        return n;
      },
      hasOpenAppeal: async (id) => this.openAppeals.has(id),
    };
  }
}
