import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { TwoFactorSetup } from "@/components/account/TwoFactorSetup";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("tf.setup.title")} · ${t("app.name")}` };

export default async function TwoFactorSetupPage() {
  const s = await auth();
  if (!s?.user?.id) redirect("/login?callbackUrl=/account/security/2fa/setup");
  const [row, member] = await Promise.all([
    db.twoFactorTotp.findUnique({ where: { userId: s.user.id }, select: { confirmedAt: true } }),
    db.sellerMember.findFirst({ where: { userId: s.user.id, role: { in: ["OWNER", "MANAGER"] } }, select: { userId: true } }),
  ]);
  const staff = s.user.role === "admin" || s.user.role === "super_admin";
  return (
    <main className="mx-auto max-w-content px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("tf.setup.title")}</h1>
      <p className="mt-1 text-text-muted">{t("tf.setup.lead")}</p>
      <TwoFactorSetup initiallyEnabled={!!row?.confirmedAt} roleBanner={staff || !!member} />
    </main>
  );
}
