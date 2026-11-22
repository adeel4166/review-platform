import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

export default function SellerLoading() {
  return (
    <SkeletonRegion className="mx-auto max-w-content px-4 py-6">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="mt-4 h-11 w-full max-w-md" />
      <div className="mt-6 space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
    </SkeletonRegion>
  );
}
