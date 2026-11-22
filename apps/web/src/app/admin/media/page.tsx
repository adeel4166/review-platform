import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { MediaQueue } from "@/components/admin/MediaQueue";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("admin.media.title")} · ${t("app.name")}` };

export default async function AdminMediaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/admin/media");
  if (session.user.role !== "admin" && session.user.role !== "super_admin") redirect("/"); // APIs also enforce requireAdmin
  return (
    <main className="px-4 py-6 md:px-6">
      <MediaQueue />
    </main>
  );
}
