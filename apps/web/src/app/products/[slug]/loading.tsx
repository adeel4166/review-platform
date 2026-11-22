import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonRegion className="mx-auto max-w-content px-4 py-6 md:px-6 lg:px-8">
      <Skeleton className="h-4 w-40" />
      <div className="mt-4 grid gap-6 md:grid-cols-[14rem_1fr] lg:grid-cols-[20rem_1fr]">
        <Skeleton className="aspect-square w-full max-w-[14rem] md:max-w-none" />
        <div><Skeleton className="h-4 w-24" /><Skeleton className="mt-2 h-9 w-2/3" /><Skeleton className="mt-3 h-6 w-1/2" /></div>
      </div>
      <Skeleton className="mt-6 h-44 w-full" />
      {[0, 1, 2].map((i) => <Skeleton key={i} className="mt-4 h-32 w-full" />)}
    </SkeletonRegion>
  );
}
