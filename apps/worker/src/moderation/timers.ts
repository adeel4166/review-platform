import { holdExpireJobId, postReviewLapseJobId, delayUntil, transition, type Clock, type ModerationConfig, type Store, type Target, type RowKind } from "@rp/core";

export interface TimerDeps { store: Store; clock: Clock; config: ModerationConfig; reasonCodes: ReadonlySet<string> }
export interface TimerPayload { caseId: string; target: Target; kind?: RowKind; deadlineMs: number }
export type TimerOutcome = "applied" | "noop";

/** `moderation.hold-expire`: T7 / R7. The deadline in the payload must equal the stored one (TMR-013, MT-1). */
export async function holdExpire(d: TimerDeps, p: TimerPayload): Promise<TimerOutcome> {
  return run(d, p, "HOLD_EXPIRE");
}
/** `moderation.post-review-lapse`: T10. */
export async function postReviewLapse(d: TimerDeps, p: TimerPayload): Promise<TimerOutcome> {
  return run(d, p, "POST_REVIEW_LAPSE");
}
async function run(d: TimerDeps, p: TimerPayload, event: "HOLD_EXPIRE" | "POST_REVIEW_LAPSE"): Promise<TimerOutcome> {
  try {
    const r = await transition(d, { target: p.target, kind: p.kind ?? "CONTENT", event, actor: { kind: "TIMER" }, caseId: p.caseId, expectedDeadlineMs: p.deadlineMs });
    return r.applied ? "applied" : "noop";
  } catch (e) {
    if (e instanceof Error && (e.name === "Error" || e.message.startsWith("invalid_transition") || e.message === "not_found")) return "noop"; // superseded / already decided (TMR-010)
    throw e;
  }
}

/** What the `moderation.hold_started` / `post_review_opened` event handlers enqueue: id embeds the deadline, delay is deadline - now. */
export function scheduleFor(kind: "hold" | "postReview", caseId: string, deadline: Date, clock: Clock, config: ModerationConfig) {
  const at = kind === "hold" ? deadline : new Date(deadline.getTime() + config.postReview.lapseAfterHours * 3_600_000);
  return { name: kind === "hold" ? "moderation.hold-expire" : "moderation.post-review-lapse", jobId: kind === "hold" ? holdExpireJobId(caseId, deadline) : postReviewLapseJobId(caseId, deadline), delay: delayUntil(at, clock) };
}
