"use client";

import type { ReactNode } from "react";
import { m } from "motion/react";

/**
 * Entrance animation (fade + small rise). Providers sets MotionConfig reducedMotion="user", so transforms are dropped under
 * prefers-reduced-motion; content is never hidden to non-JS/SSR (initial state is only applied after hydration via `initial`).
 */
export function Reveal({ children, delay = 0, className = "", as = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "li" | "section" }) {
  const C = as === "li" ? m.li : as === "section" ? m.section : m.div;
  return (
    <C className={className} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.35, delay, ease: "easeOut" }}>
      {children}
    </C>
  );
}

/** Subtle hover lift for cards; no-op under reduced motion. */
export function HoverLift({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <m.div className={className} whileHover={{ y: -3 }} transition={{ duration: 0.15 }}>{children}</m.div>;
}
