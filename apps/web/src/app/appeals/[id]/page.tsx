import Link from "next/link";
import { t } from "@/i18n/en";
import { getOwnAppeal } from "@/server/appeals";
import { appealDeps } from "@/server/appeal-deps";
import { pageUser } from "@/server/page-auth";
import { WithdrawAppeal } from "@/components/m6/WithdrawAppeal";
import { dateText } from "@/components/m6/format";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("appeal.status.h1")} · ${t("app.name")}` };

const STEPS = ["SUBMITTED", "IN_REVIEW", "DECIDED"] as const;

/** 11.3 confirmation (`?received=1`), 11.4 status and 11.5 outcome in one page. No automatic outcome ever. */
export default async function AppealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ received?: string }> }) {
  const { id } = await params;
  const { received } = await searchParams;
  const user = await pageUser(`/appeals/${id}`);
  let a;
  try { a = await getOwnAppeal((await appealDeps()).db, user.id, id); } catch { return <main className="mx-auto max-w-reading px-4 py-6"><h1 className="text-2xl font-semibold">{t("notice.notFound")}</h1></main>; }
  const decided = a.status !== "SUBMITTED" && a.status !== "IN_REVIEW";
  const current = decided ? "DECIDED" : a.status;
  return (
    <main className="mx-auto max-w-reading px-4 py-6">
      <h1 className="text-2xl font-semibold">{received ? t("appeal.received.h1") : t("appeal.status.h1")}</h1>
      {received && <p role="status" className="mt-2">{t("appeal.received.body", { id: a.id })}</p>}
      <p className="mt-2 text-text-muted">{t("appeal.submittedOn", { date: dateText(a.submittedAt) })}</p>
      <ol aria-label={t("appeal.steps")} className="mt-4 space-y-1">
        {STEPS.map((s) => <li key={s} aria-current={s === current ? "step" : undefined} className={s === current ? "font-semibold" : "text-text-muted"}>{t(`appeal.step.${s}`)}{s === current ? ` (${t("appeal.step.now")})` : ""}</li>)}
      </ol>
      <section aria-labelledby="out-h" className="mt-6">
        <h2 id="out-h" className="text-lg font-semibold">{t("appeal.outcome")}</h2>
        {a.status === "UPHELD" && <p data-testid="outcome">{t("appeal.out.UPHELD")}</p>}
        {a.status === "OVERTURNED" && <p data-testid="outcome">{t("appeal.out.OVERTURNED")}</p>}
        {a.status === "PARTIALLY_OVERTURNED" && <p data-testid="outcome">{t("appeal.out.PARTIALLY_OVERTURNED")}</p>}
        {a.status === "WITHDRAWN" && <p data-testid="outcome">{t("appeal.out.WITHDRAWN")}</p>}
        {!decided && <p data-testid="outcome">{t("appeal.out.pending")}</p>}
        {decided && a.decisionNote && <p className="mt-2">{t("appeal.note", { note: a.decisionNote })}</p>}
        {a.status === "UPHELD" && <p className="mt-2"><a className="text-link underline" href="mailto:support@example.com">{t("notice.contact")}</a></p>}
      </section>
      {!decided && <div className="mt-6"><WithdrawAppeal id={a.id} /></div>}
      <p className="mt-6"><Link className="text-link underline" href="/account/submissions">{t("submissions.h1")}</Link></p>
    </main>
  );
}
