"use client";

import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const DialogRoot = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export const DialogTitle = D.Title;
export const DialogDescription = D.Description;

export function DialogOverlay({ className, ...props }: React.ComponentProps<typeof D.Overlay>) {
  return <D.Overlay className={cn("fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0", className)} {...props} />;
}

export function DialogContent({ className, children, closeLabel, ...props }: React.ComponentProps<typeof D.Content> & { closeLabel?: string }) {
  return (
    <D.Portal>
      <DialogOverlay />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-5 text-text shadow-lg outline-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...props}
      >
        {children}
        {closeLabel && (
          <D.Close aria-label={closeLabel} className="absolute right-3 top-3 inline-flex min-h-target min-w-target items-center justify-center rounded-md hover:bg-bg-subtle focus-visible:ring-2 focus-visible:ring-focus">
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}
