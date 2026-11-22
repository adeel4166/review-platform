import type { ReactNode } from "react";
import { t } from "@/i18n/en";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/** Shared loading / empty / error states for staff queues (design 05). Text stays visible, never colour-only. */
export function QueueLoading({ label }: { label: string }) {
  return (
    <SkeletonRegion className="space-y-2">
      <p className="text-sm text-text-muted">{label}</p>
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </SkeletonRegion>
  );
}
export function QueueEmpty({ message }: { message: string }) {
  return <EmptyState title={t("staff.queue.clear.title")} description={message} level={2} />;
}
export function QueueError({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-lg bg-danger-bg p-3 text-danger">{children}</div>;
}
