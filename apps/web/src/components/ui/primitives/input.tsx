import * as React from "react";
import { cn } from "@/lib/cn";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "min-h-target w-full rounded-md border border-border-strong bg-surface px-3 text-text outline-hidden placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
