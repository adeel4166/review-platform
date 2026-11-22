import { StaffApprovals } from "@/components/m6/StaffApprovals";
import { pageStaff } from "@/server/page-auth";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("ap4.h1")} · ${t("app.name")}` };
export default async function Page() {
  const u = await pageStaff("/admin/approvals");
  return <main className="px-4 py-6 md:px-6"><StaffApprovals staffId={u.id} /></main>;
}
