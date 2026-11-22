/** In-memory Prisma stand-in for the 2FA tables: just enough where-clause semantics for the service's conditional updates. */
type Row = Record<string, unknown>;
const isOp = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !(v instanceof Date) && !(v instanceof Uint8Array);
const val = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "bigint" ? Number(v) : v);

export function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, w]) => {
    if (k === "OR") return (w as Row[]).some((c) => matches(row, c));
    const v = row[k];
    if (w instanceof Uint8Array) return v instanceof Uint8Array && Buffer.compare(Buffer.from(v), Buffer.from(w)) === 0;
    if (isOp(w)) {
      if ("lt" in w) return v != null && (val(v) as number) < (val(w.lt) as number);
      if ("gt" in w) return v != null && (val(v) as number) > (val(w.gt) as number);
      if ("in" in w) return (w.in as unknown[]).includes(v);
      if ("not" in w) return v !== w.not;
      if ("path" in w) return isOp(v) && v[String(w.path).replace(/^\$\./, "")] === w.equals; // Prisma JSON path filter (single key)
      throw new Error(`unsupported operator ${Object.keys(w)}`);
    }
    return (v ?? null) === (w ?? null) || (v instanceof Date && w instanceof Date && v.getTime() === w.getTime());
  });
}

function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (isOp(v) && "increment" in v) row[k] = (row[k] as number) + (v.increment as number);
    else row[k] = v;
  }
}

function table(rows: Row[], defaults: () => Row = () => ({})) {
  let n = 0;
  return {
    rows,
    findUnique: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: { data: Row }) => { const r = { id: `id${++n}${rows.length}`, ...defaults(), ...data }; rows.push(r); return r; },
    createMany: async ({ data }: { data: Row[] }) => { for (const d of data) rows.push({ id: `id${++n}${rows.length}`, ...defaults(), ...d }); return { count: data.length }; },
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows.find((x) => matches(x, where)); if (!r) throw new Error("not found"); apply(r, data); return r; },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => { const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => apply(r, data)); return { count: hit.length }; },
    deleteMany: async ({ where }: { where: Row }) => { const keep = rows.filter((r) => !matches(r, where)); const count = rows.length - keep.length; rows.splice(0, rows.length, ...keep); return { count }; },
    count: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where)).length,
  };
}

export function makeTwoFactorDb() {
  const state = {
    userSession: [] as Row[], twoFactorTotp: [] as Row[], recoveryCode: [] as Row[], user: [] as Row[], userRole: [] as Row[], auditLog: [] as Row[], outboxEvent: [] as Row[],
  };
  const db: Row & { _lock: Promise<unknown> } = {
    userSession: table(state.userSession, () => ({ revokedAt: null, successorId: null, successorClaimedAt: null, twoFactorFailures: 0, secondFactorVerifiedAt: null, secondFactorMethod: null, reauthenticatedAt: null, secondFactorPending: false, pendingExpiresAt: null })),
    twoFactorTotp: table(state.twoFactorTotp, () => ({ secretCiphertext: null, keyId: null, confirmedAt: null, lastUsedStep: null, pendingSecretCiphertext: null, pendingKeyId: null, pendingExpiresAt: null })),
    recoveryCode: table(state.recoveryCode, () => ({ usedAt: null })),
    user: table(state.user),
    userRole: table(state.userRole),
    auditLog: table(state.auditLog),
    outboxEvent: table(state.outboxEvent),
    // Transactions are serialised (like row locks) and roll back on throw.
    _lock: Promise.resolve() as Promise<unknown>,
    async $transaction<T>(fn: (tx: Row) => Promise<T>): Promise<T> {
      const run = async () => {
        const snap = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
        try { return await fn(db); } catch (e) {
          for (const [k, v] of Object.entries(state)) v.splice(0, v.length, ...(snap[k] as Row[]));
          throw e;
        }
      };
      const p = db._lock.then(run, run);
      db._lock = p.catch(() => undefined);
      return p;
    },
  };
  return { db, state };
}
