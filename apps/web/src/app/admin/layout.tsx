import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";

/** Staff shell (07): the same rail on every admin page. APIs and pages enforce roles; the rail is only navigation. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
