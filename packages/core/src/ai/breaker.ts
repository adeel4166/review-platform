import type { Clock } from "../clock";

/** Circuit breaker over the last N calls (ADR-0028): opens at >= failureRatio, half-open after openSeconds. */
export class Breaker {
  private results: boolean[] = [];
  private openedAt: number | null = null;
  constructor(private clock: Clock, private opts: { windowSize: number; failureRatio: number; openSeconds: number }) {}
  /** true -> a call may be made (closed, or half-open probe). */
  allow(): boolean {
    if (this.openedAt === null) return true;
    return this.clock.now().getTime() - this.openedAt >= this.opts.openSeconds * 1000;
  }
  isOpen(): boolean { return !this.allow(); }
  record(ok: boolean): void {
    if (this.openedAt !== null) { // half-open probe
      if (ok) { this.openedAt = null; this.results = []; } else this.openedAt = this.clock.now().getTime();
      return;
    }
    this.results.push(ok);
    if (this.results.length > this.opts.windowSize) this.results.shift();
    if (this.results.length >= this.opts.windowSize && this.results.filter((r) => !r).length / this.results.length >= this.opts.failureRatio) this.openedAt = this.clock.now().getTime();
  }
}

/** Daily provider call cap (spend cap); the 21st... style guard of ADR-0028. */
export class DailyCap {
  private day = ""; private n = 0;
  constructor(private clock: Clock, private cap: number) {}
  take(): boolean {
    const d = this.clock.now().toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.n = 0; }
    if (this.n >= this.cap) return false;
    this.n++;
    return true;
  }
}
