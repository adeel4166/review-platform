import { EnforcementForm } from "@/components/m6/EnforcementForm";
import { pageStaff } from "@/server/page-auth";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("enf.h1")} · ${t("app.name")}` };
export default async function Page() {
  await pageStaff("/admin/enforcement");
  return <main className="mx-auto max-w-content px-4 py-6"><EnforcementForm /></main>;
}
