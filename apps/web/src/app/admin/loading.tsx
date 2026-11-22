import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

export default function AdminLoading() {
  return (
    <SkeletonRegion className="px-4 py-6">
      <Skeleton className="h-8 w-1/3" />
      <div className="mt-4 space-y-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
    </SkeletonRegion>
  );
}
