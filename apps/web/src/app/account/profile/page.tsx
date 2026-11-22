import Link from "next/link";
import { db } from "@/server/db";
import { t } from "@/i18n/en";
import { getOwnProfile } from "@/server/social";
import { pageUser } from "@/server/page-auth";
import { ProfileEditor } from "@/components/m6/ProfileEditor";
import { TrustBand } from "@/components/TrustBand";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("profile.edit.h1")} · ${t("app.name")}` };
export default async function OwnProfilePage() {
  const u = await pageUser("/account/profile");
  const p = await getOwnProfile(db, u.id);
  return (
    <main className="mx-auto max-w-reading px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("profile.edit.h1")}</h1>
      <p className="mt-2"><TrustBand band={p.band} /></p>
      <p className="mt-2"><Link className="text-link underline" href={`/u/${p.handle}`}>{t("profile.viewPublic")}</Link> · <Link className="text-link underline" href="/account/notifications">{t("notif.h1")}</Link> · <Link className="text-link underline" href="/account/submissions">{t("submissions.h1")}</Link></p>
      <ProfileEditor initial={p} />
    </main>
  );
}
