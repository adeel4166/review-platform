/** Moderation case state machine (ADR-0005 / ADR-0011). Pure: no I/O, easy to test exhaustively. */
export const MODERATION_STATES = ["PENDING", "AI_REVIEW", "NEEDS_HUMAN", "APPROVED", "REJECTED", "SUPERSEDED"] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

/**
 * Allowed transitions. APPROVED/REJECTED are terminal here (appeals are a later task).
 * PENDING -> NEEDS_HUMAN exists for dead-lettered jobs that never started; failures never auto-approve.
 */
export const TRANSITIONS: Readonly<Record<ModerationState, readonly ModerationState[]>> = {
  PENDING: ["AI_REVIEW", "NEEDS_HUMAN", "SUPERSEDED"],
  AI_REVIEW: ["APPROVED", "REJECTED", "NEEDS_HUMAN", "SUPERSEDED"],
  NEEDS_HUMAN: ["APPROVED", "REJECTED", "SUPERSEDED"],
  APPROVED: [],
  REJECTED: [],
  SUPERSEDED: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    public from: ModerationState,
    public to: ModerationState,
  ) {
    super(`Illegal moderation transition ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export const canTransition = (from: ModerationState, to: ModerationState): boolean => TRANSITIONS[from].includes(to);

export function assertTransition(from: ModerationState, to: ModerationState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** Review.status (ContentStatus) that mirrors a case state. */
export const REVIEW_STATUS_FOR: Readonly<Partial<Record<ModerationState, "PENDING" | "PUBLISHED" | "HIDDEN" | "REJECTED">>> = {
  PENDING: "PENDING",
  AI_REVIEW: "PENDING",
  NEEDS_HUMAN: "HIDDEN",
  APPROVED: "PUBLISHED",
  REJECTED: "REJECTED",
};
