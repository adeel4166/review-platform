"use client";

import * as React from "react";
import { DropdownMenu as M } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuRadioGroup = M.RadioGroup;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-40 overflow-hidden rounded-md border border-border bg-surface-raised p-1 text-text shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

const itemCls = "relative flex min-h-target cursor-default select-none items-center gap-2 rounded-sm px-3 outline-hidden data-highlighted:bg-bg-subtle data-disabled:opacity-50";

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof M.Item>) {
  return <M.Item className={cn(itemCls, className)} {...props} />;
}
export function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(itemCls, "pl-8", className)} {...props}>
      <span className="absolute left-2 inline-flex w-4 items-center justify-center">
        <M.ItemIndicator><Check size={16} strokeWidth={1.5} aria-hidden="true" /></M.ItemIndicator>
      </span>
      {children}
    </M.RadioItem>
  );
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-3 py-1.5 text-xs font-medium text-text-muted", className)} {...props} />;
}
export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
