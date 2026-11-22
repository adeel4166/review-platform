import { ProductCardSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonRegion className="mx-auto max-w-content px-4 py-6 md:px-6 lg:px-8">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-4 h-11 w-full max-w-2xl" />
      <div className="mt-4 flex flex-wrap gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-11 w-24 rounded-full" />)}</div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>
    </SkeletonRegion>
  );
}
