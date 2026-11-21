import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ClaimsQueue } from "@/components/admin/ClaimsQueue";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("admin.claims.title")} · ${t("app.name")}` };

export default async function AdminSellerClaimsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/admin/seller-claims");
  if (session.user.role !== "admin" && session.user.role !== "super_admin") redirect("/"); // APIs also enforce requireAdmin
  return (
    <main className="mx-auto max-w-content px-4 py-6">
      <ClaimsQueue />
    </main>
  );
}
