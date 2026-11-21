import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ModerationDashboard } from "@/components/admin/ModerationDashboard";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("mod.title")} · ${t("app.name")}` };

export default async function AdminModerationPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/admin/moderation");
  if (session.user.role !== "admin") redirect("/"); // non-admins never see the dashboard; APIs also enforce requireAdmin
  return (
    <main className="mx-auto max-w-content px-4 py-6">
      <ModerationDashboard />
    </main>
  );
}
