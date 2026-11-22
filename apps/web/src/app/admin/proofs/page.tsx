import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ProofsQueue } from "@/components/admin/ProofsQueue";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("admin.proofs.title")} · ${t("app.name")}` };

export default async function AdminProofsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/admin/proofs");
  if (session.user.role !== "admin" && session.user.role !== "super_admin") redirect("/"); // APIs also enforce requireAdmin
  return (
    <main className="px-4 py-6 md:px-6">
      <ProofsQueue staffId={session.user.id} />
    </main>
  );
}
