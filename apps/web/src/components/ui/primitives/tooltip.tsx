"use client";

import * as React from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "@/lib/cn";

export const TooltipProvider = T.Provider;
export const Tooltip = T.Root;
export const TooltipTrigger = T.Trigger;

export function TooltipContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof T.Content>) {
  return (
    <T.Portal>
      <T.Content
        sideOffset={sideOffset}
        className={cn("z-50 rounded-md bg-text px-3 py-1.5 text-xs text-bg shadow-md data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0", className)}
        {...props}
      />
    </T.Portal>
  );
}
