import Link from "next/link";
import { db } from "@/server/db";
import { t, type MessageKey } from "@/i18n/en";
import { clock } from "@/server/m6-routes";
import { getDecisionNotice } from "@/server/m6-ui";
import { pageUser } from "@/server/page-auth";
import { dateText, daysLeft } from "@/components/m6/format";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("notice.meta")} · ${t("app.name")}` };

/** 11.1 Decision notice (statement of reasons). Author only; anyone else gets the neutral 404 from the service. */
export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser(`/decisions/${id}`);
  const now = clock.now();
  let n;
  try { n = await getDecisionNotice(db, user.id, id, now); } catch { return <main className="mx-auto max-w-reading px-4 py-6 md:px-6 md:py-8 lg:px-8"><h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("notice.notFound")}</h1></main>; }
  const left = daysLeft(n.appealableUntil, now.getTime());
  return (
    <main className="mx-auto max-w-reading px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{t(`notice.h1.${n.kind}` as MessageKey)}</h1>
      <p className="mt-2" data-testid="notice-content">{t("notice.content", { title: n.title ?? t("notice.reply"), product: n.product?.name ?? "" })}</p>
      {n.decidedAt && <p className="text-text-muted">{t("notice.decided", { date: dateText(n.decidedAt), by: t(`notice.by.${n.source}` as MessageKey) })}</p>}
      {n.kind === "UNDER_REVIEW" && (
        <p className="mt-3" data-testid="notice-under-review">{t("notice.underReview")}{n.holdExpiresAt ? ` ${t("notice.holdUntil", { date: dateText(n.holdExpiresAt) })}` : ""}</p>
      )}
      {(n.kind === "NOT_PUBLISHED" || n.kind === "REMOVED") && (
        <section aria-labelledby="why-h" className="mt-4">
          <h2 id="why-h" className="text-lg font-semibold">{t("notice.reasonHeading")}</h2>
          <p data-testid="notice-reason">{n.notReviewedInTime ? t("notice.notReviewedInTime") : n.publicReason ?? t("notice.noReason")}</p>
          <p className="mt-2">{t("notice.visibility")} <span data-testid="notice-strike">{n.strike ? t("notice.strike.yes") : t("notice.strike.no")}</span></p>
        </section>
      )}
      {n.kind === "RESTORED" && <p role="status" data-testid="notice-restored" className="mt-3 font-semibold">{t("notice.restored")}</p>}
      {n.appealId ? (
        <p className="mt-4"><Link className="text-link underline" href={`/appeals/${n.appealId}`}>{t("notice.viewAppeal")}</Link></p>
      ) : n.canAppeal ? (
        <p className="mt-4">
          <Link data-testid="appeal-link" className="inline-flex min-h-target items-center rounded-md bg-primary px-4 font-semibold text-on-primary" href={`/appeals/new?decision=${encodeURIComponent(n.id)}`}>{t("notice.appeal")}</Link>
          <span className="ml-3">{t("notice.appealBy", { date: dateText(n.appealableUntil), days: left ?? 0 })}</span>
        </p>
      ) : n.appealClosed ? (
        <p className="mt-4" data-testid="appeal-closed">{t("notice.appealEnded", { date: dateText(n.appealableUntil) })} <a className="text-link underline" href="mailto:support@example.com">{t("notice.contact")}</a></p>
      ) : null}
    </main>
  );
}
