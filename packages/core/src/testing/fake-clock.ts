import type { Clock } from "../clock";

/** __RP_TEST_ONLY__ — must never appear in a production bundle (OPS-003 greps for this sentinel). */
export class FakeClock implements Clock {
  private t: number;
  constructor(start: Date | string = "2027-01-04T09:00:00.000Z") {
    this.t = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(t: Date | string): void {
    this.t = new Date(t).getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
