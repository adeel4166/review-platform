"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { LazyMotion, MotionConfig } from "motion/react";

const loadFeatures = () => import("@/lib/motion-features").then((m) => m.default);

/**
 * Client providers (ADR-0034 D6/D7): next-themes (data-theme, localStorage `rp-theme`, nonce'd no-flash script),
 * Motion with reducedMotion="user" (OS setting is authoritative; components must not override it).
 */
export function Providers({ nonce, children }: { nonce?: string; children: ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem themes={["light", "dark"]} storageKey="rp-theme" disableTransitionOnChange nonce={nonce}>
      <MotionConfig reducedMotion="user" nonce={nonce}>
        <LazyMotion features={loadFeatures} strict>
          {children}
        </LazyMotion>
      </MotionConfig>
    </ThemeProvider>
  );
}
