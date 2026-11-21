import { QUEUES, jobId, type QueueName } from "@rp/core";

export interface OutboxRow {
  id: bigint;
  type: string;
  aggregateId: string;
  payload: unknown;
}

/** Maps outbox event types to a target queue. Extend as features add events. */
export const routes: Record<string, QueueName> = {
  "review.submitted": QUEUES.moderation,
  "seller_reply.submitted": QUEUES.moderation,
  "seller_reply.edited": QUEUES.moderation,
  "media.uploaded": QUEUES.media,
  "user.email_verification_requested": QUEUES.notifications,
  "user.registration_conflict": QUEUES.notifications,
  "seller.invitation_created": QUEUES.notifications,
  // M3-05 ownership claims (spec §7)
  "claim.submitted": QUEUES.verification,
  "claim.check_due": QUEUES.verification,
  "claim.verified": QUEUES.notifications,
  "claim.rejected": QUEUES.notifications,
  "claim.expired": QUEUES.notifications,
  "claim.revoked": QUEUES.notifications,
  "claim.contested": QUEUES.notifications,
  "claim.grace_started": QUEUES.notifications,
  "seller.downgraded": QUEUES.notifications,
};

export interface OutboxStore {
  fetchUnpublished(limit: number): Promise<OutboxRow[]>;
  markPublished(ids: bigint[]): Promise<void>;
}
export interface Enqueuer {
  add(queue: QueueName, name: string, data: unknown, opts: { jobId: string }): Promise<unknown>;
}

/** One relay pass. At-least-once: publish first, then mark; deterministic jobId dedupes retries. */
export async function relayOnce(store: OutboxStore, queues: Enqueuer, batch = 100): Promise<number> {
  const rows = await store.fetchUnpublished(batch);
  const done: bigint[] = [];
  for (const row of rows) {
    const queue = routes[row.type];
    if (!queue) {
      console.warn(JSON.stringify({ msg: "outbox.unrouted", type: row.type, id: String(row.id) }));
      done.push(row.id); // unknown types are skipped, not retried forever
      continue;
    }
    await queues.add(queue, row.type, row.payload, { jobId: jobId("outbox", String(row.id)) });
    done.push(row.id);
  }
  if (done.length) await store.markPublished(done);
  return done.length;
}
