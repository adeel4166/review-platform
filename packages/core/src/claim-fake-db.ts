/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory stand-in for the Prisma subset claim-service uses (tests only) */
import type { ClaimDb } from "./claim-service";
type Row = Record<string, any>;

function cmp(r: any, v: any): boolean {
  if (v instanceof Date) return r instanceof Date && r.getTime() === v.getTime();
  if (v && typeof v === "object") {
    const t = (x: any) => (x instanceof Date ? x.getTime() : x);
    return Object.entries(v).every(([op, x]) => {
      if (op === "not") return !cmp(r, x);
      if (op === "in") return (x as any[]).includes(r);
      if (op === "gt") return r != null && t(r) > t(x);
      if (op === "gte") return r != null && t(r) >= t(x);
      if (op === "lt") return r != null && t(r) < t(x);
      if (op === "lte") return r != null && t(r) <= t(x);
      return false;
    });
  }
  return (r ?? null) === (v ?? null);
}
function match(r: Row, w: Row = {}): boolean {
  return Object.entries(w).every(([k, v]) => {
    if (k === "OR") return (v as Row[]).some((x) => match(r, x));
    if (k === "sellerId_userId") return r.sellerId === (v as Row).sellerId && r.userId === (v as Row).userId;
    return cmp(r[k], v);
  });
}

/** Minimal in-memory DB: enough for applyClaimTransition + the verification worker. Emulates the unique verifiedDomainKey. */
export function createFakeClaimDb(seed: Partial<Record<string, Row[]>> = {}) {
  const t: Record<string, Row[]> = {
    sellerOwnershipClaim: [], sellerClaimDecision: [], seller: [], sellerMember: [], user: [], product: [], enforcementAction: [], auditLog: [], outboxEvent: [],
  };
  for (const [k, v] of Object.entries(seed)) t[k] = (v ?? []).map((r) => ({ ...r }));
  let n = 0;
  const table = (name: string) => ({
    findUnique: async ({ where }: Row) => { const r = t[name]!.find((x) => match(x, where)); return r ? { ...r } : null; },
    findFirst: async ({ where }: Row = {}) => { const r = t[name]!.find((x) => match(x, where)); return r ? { ...r } : null; },
    findMany: async ({ where, take }: Row = {}) => t[name]!.filter((x) => match(x, where)).slice(0, take ?? 1e9).map((x) => ({ ...x })),
    count: async ({ where }: Row = {}) => t[name]!.filter((x) => match(x, where)).length,
    create: async ({ data }: Row) => { const row = { id: `${name}${++n}`, createdAt: new Date(), ...data }; t[name]!.push(row); return { ...row }; },
    update: async ({ where, data }: Row) => {
      const r = t[name]!.find((x) => match(x, where));
      if (!r) throw new Error(`${name} not found`);
      const next: Row = { ...r };
      for (const [k, v] of Object.entries(data)) next[k] = v && typeof v === "object" && "increment" in (v as Row) ? (r[k] ?? 0) + (v as Row).increment : v;
      if (name === "sellerOwnershipClaim" && next.verifiedDomainKey && t[name]!.some((x) => x !== r && x.verifiedDomainKey === next.verifiedDomainKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
      Object.assign(r, next);
      return { ...r };
    },
    updateMany: async ({ where, data }: Row) => { const rows = t[name]!.filter((x) => match(x, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
  });
  const db: Record<string, any> = {
    t,
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
  };
  for (const k of Object.keys(t)) db[k] = table(k);
  return db as unknown as ClaimDb & Record<string, any> & { t: Record<string, Row[]> };
}
