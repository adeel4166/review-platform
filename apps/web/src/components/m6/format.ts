/** Static, non-ticking date text for notices and countdowns (11 a11y notes: no per-second announcements). */
export const dateText = (d: Date | string | null | undefined): string => (d ? new Date(d).toISOString().slice(0, 10) : "");
export function daysLeft(until: Date | string | null | undefined, now: number): number | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
