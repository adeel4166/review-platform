import { StaffAppeals } from "@/components/m6/StaffAppeals";
import { pageStaff } from "@/server/page-auth";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("sa.h1")} · ${t("app.name")}` };
export default async function AdminAppealsPage() {
  await pageStaff("/admin/appeals");
  return <main className="mx-auto max-w-content px-4 py-6"><StaffAppeals /></main>;
}
