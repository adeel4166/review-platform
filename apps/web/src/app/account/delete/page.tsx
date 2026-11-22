import { db } from "@/server/db";
import { t } from "@/i18n/en";
import { getOwnProfile } from "@/server/social";
import { pageUser } from "@/server/page-auth";
import { AccountErasure } from "@/components/account/AccountErasure";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("erase.h2")} · ${t("app.name")}` };
export default async function DeleteAccountPage() {
  const u = await pageUser("/account/delete");
  const p = await getOwnProfile(db, u.id);
  return (
    <main className="mx-auto max-w-reading px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("erase.open")}</h1>
      <AccountErasure handle={p.handle} />
    </main>
  );
}
