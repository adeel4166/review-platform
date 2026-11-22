import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { CreateSellerForm } from "@/components/seller/CreateSellerForm";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("seller.new.title")} · ${t("app.name")}` };

export default async function NewSellerPage() {
  if (!(await auth())?.user?.id) redirect("/login?callbackUrl=/sellers/new");
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("seller.new.title")}</h1>
      <p className="mt-2 text-text-muted">{t("seller.new.intro")}</p>
      <div className="mt-4 rounded-lg border border-border bg-surface p-4 sm:p-6"><CreateSellerForm /></div>
    </main>
  );
}
