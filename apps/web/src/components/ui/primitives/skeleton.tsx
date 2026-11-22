import * as React from "react";
import { cn } from "@/lib/cn";

export function SkeletonPrimitive({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("rounded-md bg-bg-subtle motion-safe:animate-pulse", className)} {...props} />;
}
