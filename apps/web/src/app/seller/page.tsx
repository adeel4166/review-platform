import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { listMySellers } from "@/server/seller-views";
import { t, type MessageKey } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("seller.list.title")} · ${t("app.name")}` };

export default async function MySellersPage() {
  const s = await auth();
  if (!s?.user?.id) redirect("/login?callbackUrl=/seller");
  const sellers = await listMySellers(db, { id: s.user.id, role: s.user.role });
  return (
    <main className="mx-auto max-w-content px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("seller.list.title")}</h1>
      {sellers.length === 0 ? <p className="mt-3">{t("seller.list.empty")}</p> : (
        <ul className="mt-4 space-y-2">
          {sellers.map((x) => (
            <li key={x.id}><Link className="inline-flex min-h-target items-center text-link underline" href={`/seller/${x.id}`}>{x.name}</Link> <span className="text-text-muted">· {t(`role.${x.role}` as MessageKey)}</span></li>
          ))}
        </ul>
      )}
      <Link href="/sellers/new" className="mt-6 inline-flex min-h-target items-center rounded-md bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover">{t("seller.list.create")}</Link>
    </main>
  );
}
