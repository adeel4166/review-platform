import { addDays, addHours, addMinutes, type Clock } from "../clock";
import type { ModerationConfig } from "./config";

/** Deadlines are computed once from the config in force when the timer starts and stored absolute (TMR-008). */
export const holdDeadline = (now: Date, cfg: ModerationConfig): Date => addDays(now, cfg.timers.holdDays);
export const postReviewDue = (publishedAt: Date, cfg: ModerationConfig): Date => addHours(publishedAt, cfg.timers.postReviewSlaHours);
export const postReviewLapseAt = (dueAt: Date, cfg: ModerationConfig): Date => addHours(dueAt, cfg.postReview.lapseAfterHours);
export const holdReminderAt = (holdExpiresAt: Date, cfg: ModerationConfig): Date => addHours(holdExpiresAt, -cfg.timers.holdReminderHours);
export const reportedSlaDue = (now: Date, cfg: ModerationConfig): Date => addHours(now, cfg.timers.reportedSlaHours);
export const appealWindowEnd = (now: Date, cfg: ModerationConfig): Date => addDays(now, cfg.timers.appealWindowDays);
export const appealSlaDue = (submittedAt: Date, holdExpired: boolean, cfg: ModerationConfig): Date =>
  addHours(submittedAt, holdExpired ? cfg.timers.appealSlaHoursHoldExpired : cfg.timers.appealSlaHours);
export const LEASE_MINUTES = 15;
export const leaseEnd = (now: Date): Date => addMinutes(now, LEASE_MINUTES);
/** AI pending guard: 10 min, or media wait + 10 min when media is pending (AIF-006). */
export const aiPendingGuardAt = (createdAt: Date, cfg: ModerationConfig, hasPendingMedia: boolean): Date =>
  addMinutes(createdAt, hasPendingMedia ? cfg.media.maxWaitMinutes + 10 : cfg.ai.maxPendingMinutes);

/** A timer fires when now >= deadline (TMR-003). */
export const reached = (deadline: Date | null | undefined, clock: Clock): boolean => !!deadline && clock.now().getTime() >= deadline.getTime();
/** Appeal window is open strictly before the end (TMR-011). */
export const windowOpen = (until: Date | null | undefined, clock: Clock): boolean => !!until && clock.now().getTime() < until.getTime();

export const holdExpireJobId = (caseId: string, deadline: Date): string => `hold-expire__${caseId}__${deadline.getTime()}`;
export const postReviewLapseJobId = (caseId: string, deadline: Date): string => `pr-lapse__${caseId}__${deadline.getTime()}`;
