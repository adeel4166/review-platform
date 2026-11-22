/** Tiny in-memory Prisma stand-in for the retention engine (test helper only). */
type Row = Record<string, unknown>;
export function matches(r: Row, w: Row): boolean {
  return Object.entries(w).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      const x = r[k] as never;
      if ("lt" in o) return x != null && x < (o.lt as never);
      if ("gt" in o) return x != null && x > (o.gt as never);
      if ("in" in o) return (o.in as unknown[]).includes(x);
      if ("not" in o) return o.not === null ? x != null : x !== o.not;
      return false;
    }
    return (r[k] ?? null) === (v ?? null);
  });
}
export function memoryDb(models: string[]) {
  const t: Record<string, Row[]> = Object.fromEntries(models.map((m) => [m, []]));
  const db = Object.fromEntries(models.map((m) => [m, {
    findMany: async ({ where, take, select }: { where: Row; take: number; select: Row }) => { const f = Object.keys(select)[0]!; return t[m]!.filter((r) => matches(r, where)).sort((a, b) => (String(a[f]) < String(b[f]) ? -1 : 1)).slice(0, take).map((r) => ({ [f]: r[f ] ?? r.id })); },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => { const rs = t[m]!.filter((r) => matches(r, where)); rs.forEach((r) => Object.assign(r, data)); return { count: rs.length }; },
    deleteMany: async ({ where }: { where: Row }) => { const keep = t[m]!.filter((r) => !matches(r, where)); const c = t[m]!.length - keep.length; t[m] = keep; return { count: c }; },
  }]));
  return { db: db as never, t };
}
