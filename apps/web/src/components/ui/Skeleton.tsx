import { t } from "@/i18n/en";
import { SkeletonPrimitive } from "./primitives/skeleton";

/** Static-by-default block; shimmer only when motion is allowed. Size it to match the final element to avoid layout shift. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <SkeletonPrimitive className={className} />;
}

/** Wrapper that announces loading once for assistive tech. */
export function SkeletonRegion({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div aria-busy="true" className={className}>
      <p role="status" className="sr-only">{t("state.loading")}</p>
      {children}
    </div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <Skeleton className="aspect-square w-full" />
      <Skeleton className="mt-3 h-3 w-1/3" />
      <Skeleton className="mt-2 h-5 w-5/6" />
      <Skeleton className="mt-2 h-4 w-1/2" />
    </div>
  );
}
