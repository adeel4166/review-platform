import { db } from "@/server/db";
import { t } from "@/i18n/en";
import { clock } from "@/server/m6-routes";
import { getDecisionNotice } from "@/server/m6-ui";
import { pageUser } from "@/server/page-auth";
import { AppealForm } from "@/components/m6/AppealForm";
import { dateText } from "@/components/m6/format";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("appeal.new.h1")} · ${t("app.name")}` };

export default async function NewAppealPage({ searchParams }: { searchParams: Promise<{ decision?: string }> }) {
  const { decision } = await searchParams;
  const user = await pageUser(`/appeals/new?decision=${decision ?? ""}`);
  let n;
  try { n = decision ? await getDecisionNotice(db, user.id, decision, clock.now()) : null; } catch { n = null; }
  return (
    <main className="mx-auto max-w-reading px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("appeal.new.h1")}</h1>
      {!n || !n.canAppeal ? <p className="mt-3" role="status">{t("appeal.unavailable")}</p> : (
        <AppealForm caseId={n.id} summary={t("appeal.summary.text", { title: n.title ?? t("notice.reply"), date: dateText(n.decidedAt), reason: n.notReviewedInTime ? t("notice.notReviewedInTime") : n.publicReason ?? t("notice.noReason") })} />
      )}
    </main>
  );
}
