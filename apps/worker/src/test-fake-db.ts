/** Generic in-memory Prisma stand-in for the M4 services (test helper only). Supports the where/data subset the services use. */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function matchRow(r: Row, w: Row = {}): boolean {
  return Object.entries(w).every(([k, v]) => {
    if (k === "OR") return (v as Row[]).some((x) => matchRow(r, x));
    if (k === "NOT") return !matchRow(r, v);
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const ops = ["in", "notIn", "not", "gt", "gte", "lt", "lte"];
      if (Object.keys(v).some((o) => ops.includes(o))) {
        const x = r[k];
        if ("in" in v && !v.in.includes(x)) return false;
        if ("notIn" in v && v.notIn.includes(x)) return false;
        if ("not" in v) { const n = v.not; if (n === null ? x == null : (typeof n === "object" && !(n instanceof Date) ? matchRow({ [k]: x }, { [k]: n }) : x === n)) return false; }
        if ("gt" in v && !(x != null && x > v.gt)) return false;
        if ("gte" in v && !(x != null && x >= v.gte)) return false;
        if ("lt" in v && !(x != null && x < v.lt)) return false;
        if ("lte" in v && !(x != null && x <= v.lte)) return false;
        return true;
      }
      if (r[k] === undefined && k.includes("_")) return matchRow(r, v); // compound unique key: { a_b: { a, b } }
      if (r[k] && typeof r[k] === "object") return matchRow(r[k], v);
      return false;
    }
    return (r[k] ?? null) === (v ?? null);
  });
}

export function makeFakeDb(names: string[], extras: Record<string, (r: Row, t: Record<string, Row[]>) => Row> = {}, defaults: Record<string, Row> = {}) {
  const t: Record<string, Row[]> = Object.fromEntries(names.map((n) => [n, []]));
  let n = 0;
  const apply = (r: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && ("increment" in v || "decrement" in v)) r[k] = (r[k] ?? 0) + ((v as Row).increment ?? 0) - ((v as Row).decrement ?? 0);
      else r[k] = v;
    }
  };
  const view = (name: string) => t[name]!.map((r) => (extras[name] ? { ...r, ...extras[name]!(r, t) } : r));
  const dbl: Row = { $transaction: async (fn: (x: unknown) => unknown) => fn(dbl), t };
  for (const name of names) {
    dbl[name] = {
      findUnique: async ({ where }: Row) => { const r = view(name).find((x) => matchRow(x, where)); return r ? { ...r } : null; },
      findFirst: async ({ where }: Row = {}) => { const r = view(name).find((x) => matchRow(x, where)); return r ? { ...r } : null; },
      findUniqueOrThrow: async ({ where }: Row) => { const r = view(name).find((x) => matchRow(x, where)); if (!r) throw new Error("not found"); return { ...r }; },
      findMany: async ({ where }: Row = {}) => view(name).filter((x) => matchRow(x, where)).map((x) => ({ ...x })),
      count: async ({ where }: Row = {}) => view(name).filter((x) => matchRow(x, where)).length,
      create: async ({ data }: Row) => {
        const row = { id: `${name}${++n}`, createdAt: new Date(), ...(defaults[name] ?? {}), ...data };
        for (const [k, v] of Object.entries(data)) if (k === "openReportKey" && v && t[name]!.some((x) => x.openReportKey === v)) throw Object.assign(new Error("unique"), { code: "P2002" });
        if (name === "report" && t[name]!.some((x) => x.reporterId === row.reporterId && ((x.reviewId && x.reviewId === row.reviewId) || (x.sellerReplyId && x.sellerReplyId === row.sellerReplyId)))) throw Object.assign(new Error("unique"), { code: "P2002" });
        if (name === "purchaseProof" && row.openKey && t[name]!.some((x) => x.openKey === row.openKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
        t[name]!.push(row);
        return { ...row };
      },
      upsert: async ({ where, create, update }: Row) => { const r = t[name]!.find((x) => matchRow(x, where)); if (r) { apply(r, update); return { ...r }; } const row = { id: `${name}${++n}`, createdAt: new Date(), ...create }; t[name]!.push(row); return { ...row }; },
      update: async ({ where, data }: Row) => { const r = t[name]!.find((x) => matchRow(x, where)); if (!r) throw new Error("not found"); apply(r, data); return { ...r }; },
      updateMany: async ({ where, data }: Row) => { const rows = t[name]!.filter((x) => matchRow(x, where)); rows.forEach((r) => apply(r, data)); return { count: rows.length }; },
      deleteMany: async ({ where }: Row) => { const keep = t[name]!.filter((x) => !matchRow(x, where)); const c = t[name]!.length - keep.length; t[name] = keep; return { count: c }; },
    };
  }
  return { db: dbl as never, t };
}
