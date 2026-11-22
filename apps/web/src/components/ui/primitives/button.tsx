import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex min-h-target shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-fast ease-standard outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover",
        secondary: "border border-border-strong bg-surface px-4 text-text hover:bg-bg-subtle",
        ghost: "px-3 text-text hover:bg-bg-subtle",
        danger: "bg-danger px-4 font-semibold text-white hover:bg-danger/90",
        link: "text-link underline underline-offset-2",
      },
      size: { md: "", icon: "min-w-target px-0" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
