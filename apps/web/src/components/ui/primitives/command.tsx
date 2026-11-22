"use client";

import * as React from "react";
import { Command as C } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

export function Command({ className, ...props }: React.ComponentProps<typeof C>) {
  return <C className={cn("flex w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised text-text", className)} {...props} />;
}
export function CommandInput({ className, ...props }: React.ComponentProps<typeof C.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3">
      <Search size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text-muted" />
      <C.Input className={cn("min-h-target w-full bg-transparent outline-hidden placeholder:text-text-muted", className)} {...props} />
    </div>
  );
}
export function CommandList({ className, ...props }: React.ComponentProps<typeof C.List>) {
  return <C.List className={cn("max-h-72 overflow-y-auto p-1", className)} {...props} />;
}
export function CommandEmpty({ className, ...props }: React.ComponentProps<typeof C.Empty>) {
  return <C.Empty className={cn("p-4 text-center text-sm text-text-muted", className)} {...props} />;
}
export function CommandGroup({ className, ...props }: React.ComponentProps<typeof C.Group>) {
  return <C.Group className={cn("[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-text-muted", className)} {...props} />;
}
export function CommandItem({ className, ...props }: React.ComponentProps<typeof C.Item>) {
  return <C.Item className={cn("flex min-h-target cursor-default items-center gap-2 rounded-sm px-3 outline-hidden data-[selected=true]:bg-bg-subtle", className)} {...props} />;
}
