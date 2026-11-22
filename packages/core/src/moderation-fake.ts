/** In-memory stand-in for the Prisma subset used by the moderation service. Test helper only. */
type Row = Record<string, unknown>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "in" in (v as Row)) return ((v as { in: unknown[] }).in).includes(row[k]);
    return row[k] === v;
  });
}

export class FakeModerationDb {
  reviews: Row[] = [];
  cases: Row[] = [];
  revisions: Row[] = [];
  replies: Row[] = [];
  audit: Row[] = [];
  private seq = 0;
  /** Test hook: runs right before a case updateMany, to simulate a concurrent writer. */
  beforeCaseUpdate?: () => void;

  addReview(over: Row = {}) {
    const r = { id: `r${++this.seq}`, status: "PENDING", currentVersion: 1, rating: 5, title: "Nice", body: "A perfectly fine long body text.", publishedAt: null, publishedVersion: null, ...over };
    this.reviews.push(r);
    this.revisions.push({ reviewId: r.id, version: r.currentVersion, status: "PENDING" });
    return r;
  }
  addReply(over: Row = {}) {
    const r = { id: `rp${++this.seq}`, sellerId: "S1", authorId: "u-author", status: "PENDING", version: 1, body: "Thank you for the feedback, we will look into it.", publishedAt: null, ...over };
    this.replies.push(r);
    return r;
  }
  addReplyCase(sellerReplyId: string, state = "PENDING", version = 1) {
    const c = { id: `c${++this.seq}`, subjectType: "SELLER_REPLY", reviewId: null, sellerReplyId, version, state };
    this.cases.push(c);
    return c;
  }
  addCase(reviewId: string, state = "PENDING", version = 1) {
    const c: { id: string; reviewId: string; version: number; state: string; trigger?: string } = { id: `c${++this.seq}`, reviewId, version, state };
    this.cases.push(c);
    return c;
  }

  private pick(rows: Row[], where: Row) {
    return rows.find((r) => matches(r, where)) ?? null;
  }
  private patch(rows: Row[], where: Row, data: Row) {
    const hit = rows.filter((r) => matches(r, where));
    hit.forEach((r) => Object.assign(r, data));
    return { count: hit.length };
  }

  moderationCase = {
    findUnique: async (a: unknown) => this.pick(this.cases, (a as { where: Row }).where) as never,
    updateMany: async (a: unknown) => {
      this.beforeCaseUpdate?.();
      const { where, data } = a as { where: Row; data: Row };
      return this.patch(this.cases, where, data);
    },
    upsert: async (a: unknown) => {
      type K = { reviewId: string; version: number; trigger?: string; seq?: number };
      const { where, create } = a as { where: { reviewId_version_trigger_seq?: K; sellerReplyId_version_trigger_seq?: { sellerReplyId: string; version: number } }; create?: Row };
      if (where.sellerReplyId_version_trigger_seq) {
        const { sellerReplyId, version } = where.sellerReplyId_version_trigger_seq;
        return (this.pick(this.cases, { sellerReplyId, version }) ?? this.addReplyCase(sellerReplyId, "PENDING", version)) as never;
      }
      const { reviewId, version, trigger } = where.reviewId_version_trigger_seq!;
      const found = this.cases.find((c) => c.reviewId === reviewId && c.version === version && (c.trigger ?? "SUBMISSION") === (trigger ?? "SUBMISSION"));
      if (found) return found as never;
      const c = this.addCase(reviewId, "PENDING", version);
      if (create?.trigger) c.trigger = String(create.trigger);
      return c as never;
    },
  };
  review = {
    findUnique: async (a: unknown) => this.pick(this.reviews, (a as { where: Row }).where) as never,
    updateMany: async (a: unknown) => {
      const { where, data } = a as { where: Row; data: Row };
      return this.patch(this.reviews, where, data);
    },
  };
  sellerReply = {
    findUnique: async (a: unknown) => this.pick(this.replies, (a as { where: Row }).where) as never,
    updateMany: async (a: unknown) => {
      const { where, data } = a as { where: Row; data: Row };
      return this.patch(this.replies, where, data);
    },
    count: async (a: unknown) => {
      const w = (a as { where: Row }).where as { sellerId: string; status: string; id: { not: string } };
      return this.replies.filter((r) => r.sellerId === w.sellerId && r.status === w.status && r.id !== w.id.not).length;
    },
  };
  reviewRevision = {
    findFirst: async (a: unknown) => {
      const w = (a as { where: Row }).where;
      const rev = this.pick(this.revisions, w) as Row | null;
      if (!rev) return null as never;
      const rv = this.reviews.find((r) => r.id === rev.reviewId) as Row;
      return { rating: rev.rating ?? rv.rating, title: rev.title ?? rv.title, body: rev.body ?? rv.body, incentive: rev.incentive } as never;
    },
    updateMany: async (a: unknown) => {
      const { where, data } = a as { where: Row; data: Row };
      return this.patch(this.revisions, where, data);
    },
  };
  auditLog = {
    create: async (a: unknown) => {
      this.audit.push((a as { data: Row }).data);
      return {};
    },
  };
  // Snapshot/rollback so a throwing transaction leaves no partial writes, like a real DB.
  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const snap = JSON.stringify([this.reviews, this.cases, this.revisions, this.audit, this.replies]);
    try {
      return await fn(this);
    } catch (e) {
      [this.reviews, this.cases, this.revisions, this.audit, this.replies] = JSON.parse(snap) as Row[][] as [Row[], Row[], Row[], Row[], Row[]];
      throw e;
    }
  }
}
