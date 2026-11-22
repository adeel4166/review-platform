import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { listMySellers } from "@/server/seller-views";
import { SellerPicker } from "@/components/seller/SellerCards";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("seller.list.title")} · ${t("app.name")}` };

export default async function MySellersPage() {
  const s = await auth();
  if (!s?.user?.id) redirect("/login?callbackUrl=/seller");
  const sellers = await listMySellers(db, { id: s.user.id, role: s.user.role });
  return (
    <main className="mx-auto max-w-content px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("seller.list.title")}</h1>
      <SellerPicker sellers={sellers.map((x) => ({ id: x.id, name: x.name, role: x.role, status: x.status }))} />
    </main>
  );
}
