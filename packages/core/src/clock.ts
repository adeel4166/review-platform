/** ADR-0024: injected clock. Production code never calls `new Date()` directly in M6 modules; composition roots pass `systemClock`. */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
export const addMs = (t: Date, ms: number): Date => new Date(t.getTime() + ms);
export const addMinutes = (t: Date, m: number): Date => addMs(t, m * 60_000);
export const addHours = (t: Date, h: number): Date => addMs(t, h * 3_600_000);
/** Always 24 h steps in UTC (TMR-004): no DST or calendar arithmetic. */
export const addDays = (t: Date, d: number): Date => addHours(t, d * 24);
/** BullMQ delay for an absolute deadline (never negative). */
export const delayUntil = (deadline: Date, clock: Clock): number => Math.max(0, deadline.getTime() - clock.now().getTime());
