import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonRegion className="mx-auto max-w-content px-4 py-6 md:px-6 lg:px-8">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="mt-4 h-12 w-full max-w-xl" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
    </SkeletonRegion>
  );
}
