import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { getSellerDashboard } from "@/server/seller-views";
import { DashboardNav } from "@/components/seller/DashboardNav";
import { SellerVerifiedBadge } from "@/components/seller/SellerVerifiedBadge";
import { TeamPanel } from "@/components/seller/TeamPanel";
import { formatDate } from "@/components/seller/ui";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("seller.dash.manage")} · ${t("app.name")}` };

export default async function SellerDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await auth();
  if (!s?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(`/seller/${id}`)}`);
  const d = await getSellerDashboard(db, { id: s.user.id, role: s.user.role }, id);
  if (!d) notFound();
  const { seller } = d;
  const open = d.claims.some((c) => c.status === "PENDING" || c.status === "CONTESTED");
  const verified = seller.status === "VERIFIED" && !!seller.verifiedDomain;
  return (
    <main className="mx-auto max-w-content px-4 py-6">
      <h1 className="text-2xl font-semibold">{seller.name}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {verified && <SellerVerifiedBadge domain={seller.verifiedDomain!} />}
        <span>{t("seller.dash.status", { status: seller.status })}</span>
        <Link className="text-link underline" href={`/sellers/${seller.slug}`}>{t("seller.dash.viewPublic")}</Link>
      </div>
      <DashboardNav sellerId={seller.id} current="overview" />

      <section aria-labelledby="att-h" className="mt-6">
        <h2 id="att-h" className="text-xl font-semibold">{t("seller.dash.attention")}</h2>
        <ul className="mt-2 space-y-2">
          {!verified && d.canManage && !open && (
            <li><span aria-hidden="true">⚠ </span>{t("seller.dash.attention.verify")} <Link className="text-link underline" href={`/seller/${seller.id}/verification`}>{t("seller.dash.attention.verifyAction")}</Link></li>
          )}
          {open && <li><span aria-hidden="true">ℹ </span>{t("seller.dash.attention.open")} <Link className="text-link underline" href={`/seller/${seller.id}/verification`}>{t("seller.dash.verification")}</Link></li>}
          {d.claims.filter((c) => c.status === "VERIFIED" && c.verifiedUntil).slice(0, 1).map((c) => (
            <li key={c.id}><span aria-hidden="true">ℹ </span>{t("seller.dash.attention.expires", { date: formatDate(c.verifiedUntil!) })}</li>
          ))}
          {(verified || !d.canManage) && !open && !d.claims.some((c) => c.status === "VERIFIED") && <li>{t("seller.dash.attention.none")}</li>}
        </ul>
      </section>

      <TeamPanel sellerId={seller.id} selfId={d.selfId} canInvite={d.canManage} canRemove={d.canRemove} members={d.members}
        invitations={d.invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))} />
    </main>
  );
}
