import { QUEUES, jobId, type QueueName } from "@rp/core";

export interface OutboxRow {
  id: bigint;
  type: string;
  aggregateId: string;
  payload: unknown;
}

/** Maps outbox event types to a target queue. Extend as features add events. */
export const routes: Record<string, QueueName> = {
  // M6 (spec §13): moderation lifecycle, appeals and four-eyes. Unrouted types are retried and alerted, never marked published.
  "moderation.assess_requested": QUEUES.moderation,
  "moderation.hold_started": QUEUES.moderation,
  "moderation.post_review_opened": QUEUES.moderation,
  "moderation.rescan_requested": QUEUES.moderation,
  "moderation.bulk_requested": QUEUES.moderation,
  "moderation.decided": QUEUES.notifications,
  "moderation.strike_requested": QUEUES.trust,
  "enforcement.zero_tolerance_hold": QUEUES.moderation,
  "notification.requested": QUEUES.notifications,
  "trust.signal": QUEUES.trust,
  "appeal.submitted": QUEUES.notifications,
  "appeal.decided": QUEUES.notifications,
  "approval.requested": QUEUES.notifications,
  "approval.executed": QUEUES.notifications,
  "review.submitted": QUEUES.moderation,
  "review.edited": QUEUES.moderation, // m4-m5-spec 16.1: R1 live edit of a PUBLISHED review
  "seller_reply.submitted": QUEUES.moderation,
  "seller_reply.edited": QUEUES.moderation,
  "media.uploaded": QUEUES.media,
  // M5 publication (m4-m5-spec 10.2): promote only after moderation approves, demote when the review leaves PUBLISHED.
  "media.promote_requested": QUEUES.media,
  "media.demote_requested": QUEUES.media,
  // M4 Verified Buyer proof (m4-m5-spec 5): evidence processing in the media group, assessment in core, notices by email.
  "proof.file_uploaded": QUEUES.media,
  "proof.submitted": QUEUES.media,
  "proof.purge_requested": QUEUES.media,
  "proof.files_ready": QUEUES.verification,
  "proof.decided": QUEUES.notifications,
  "proof.expired": QUEUES.notifications,
  "review.removed": QUEUES.notifications,
  "seller_reply.removed": QUEUES.notifications,
  "review.verified_label_revoked": QUEUES.notifications,
  "user.email_verification_requested": QUEUES.notifications,
  "user.registration_conflict": QUEUES.notifications,
  "seller.invitation_created": QUEUES.notifications,
  "claim.business_email_token_requested": QUEUES.notifications,
  "seller.ownership_transfer_requested": QUEUES.notifications,
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
  // Previously emitted but unrouted (OUT-008 / ADR-0007 section 3). Routed so they are no longer silently dropped.
  "claim.mailbox_denied": QUEUES.notifications,
  "seller.ownership_transfer_cancelled": QUEUES.notifications,
  "auth.security_alert": QUEUES.notifications,
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
