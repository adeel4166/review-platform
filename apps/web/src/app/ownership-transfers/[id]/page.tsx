import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { TransferResponse } from "@/components/seller/TransferResponse";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("own.page.title")} · ${t("app.name")}`, referrer: "no-referrer" };

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await auth())?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(`/ownership-transfers/${id}`)}`);
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-lg border border-border bg-surface p-5 shadow-sm sm:p-6">
      <h1 className="text-2xl font-semibold">{t("own.page.title")}</h1>
      <p className="mt-2">{t("own.page.lead")}</p>
      <TransferResponse id={id} />
    </div>
    </main>
  );
}
