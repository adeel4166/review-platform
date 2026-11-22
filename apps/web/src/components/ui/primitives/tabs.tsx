"use client";

import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/cn";

export const Tabs = T.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("inline-flex items-center gap-1 border-b border-border", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "inline-flex min-h-target items-center justify-center whitespace-nowrap border-b-2 border-transparent px-3 font-medium text-text-muted outline-hidden transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-focus data-[state=active]:border-primary data-[state=active]:text-text",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("outline-hidden focus-visible:ring-2 focus-visible:ring-focus", className)} {...props} />;
}
