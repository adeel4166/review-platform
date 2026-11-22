import type { ReactNode } from "react";
import { BadgePrimitive } from "./primitives/badge";

export type BadgeVariant = "verified" | "success" | "warning" | "danger" | "info" | "neutral" | "staff";

/** Status chip: always text (+ optional decorative icon), never colour alone. */
export function Badge({ variant = "neutral", children, className = "" }: { variant?: BadgeVariant; children: ReactNode; className?: string }) {
  return <BadgePrimitive variant={variant} className={className}>{children}</BadgePrimitive>;
}
