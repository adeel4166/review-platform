import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { getSellerDashboard } from "@/server/seller-views";
import { ClaimWizard } from "@/components/seller/ClaimWizard";
import { DashboardNav } from "@/components/seller/DashboardNav";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("seller.dash.verification")} · ${t("app.name")}` };

export default async function SellerVerificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await auth();
  if (!s?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(`/seller/${id}/verification`)}`);
  const d = await getSellerDashboard(db, { id: s.user.id, role: s.user.role }, id);
  if (!d || !d.canManage) notFound(); // RESPONDERs and outsiders get the same 404; the API enforces it too
  return (
    <main className="mx-auto max-w-content px-4 py-6">
      <h1 className="text-2xl font-semibold">{d.seller.name}</h1>
      <DashboardNav sellerId={d.seller.id} current="verification" />
      <div className="mt-6">
        <ClaimWizard sellerId={d.seller.id}
          initialClaims={d.claims.map((c) => ({ id: c.id, method: c.method, status: c.status, domain: c.domain, lastCheckOutcome: c.lastCheckOutcome, challengeExpiresAt: c.challengeExpiresAt?.toISOString() ?? null, lastCheckAt: c.lastCheckAt?.toISOString() ?? null, verifiedUntil: c.verifiedUntil?.toISOString() ?? null }))} />
      </div>
    </main>
  );
}
