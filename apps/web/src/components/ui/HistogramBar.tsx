"use client";

import * as m from "motion/react-m";

/** Bar fills 0→value once when scrolled into view; MotionConfig reducedMotion="user" makes it instant for reduced-motion users. Fills from the inline-start. */
export function HistogramBar({ pct }: { pct: number }) {
  return (
    <span aria-hidden="true" className="h-2.5 flex-1 overflow-hidden rounded-full border border-border bg-bg-subtle">
      <m.span className="block h-full rounded-full bg-star" initial={{ width: 0 }} whileInView={{ width: `${pct}%` }} viewport={{ once: true }} transition={{ duration: 0.6, ease: "easeOut" }} />
    </span>
  );
}
