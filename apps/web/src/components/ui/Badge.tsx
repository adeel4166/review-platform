import type { ReactNode } from "react";

export type BadgeVariant = "verified" | "success" | "warning" | "danger" | "info" | "neutral" | "staff";
const styles: Record<BadgeVariant, string> = {
  verified: "bg-success-bg text-success",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  neutral: "bg-bg-subtle text-text border border-border",
  staff: "border border-primary text-primary",
};

/** Status chip: always text (+ optional decorative icon), never colour alone. */
export function Badge({ variant = "neutral", children, className = "" }: { variant?: BadgeVariant; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles[variant]} ${className}`}>{children}</span>;
}
