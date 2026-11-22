import Link from "next/link";
import { db } from "@/server/db";
import { t } from "@/i18n/en";
import { clock } from "@/server/m6-routes";
import { listMyCases } from "@/server/m6-ui";
import { pageUser } from "@/server/page-auth";
import { dateText } from "@/components/m6/format";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("submissions.h1")} · ${t("app.name")}` };

/** The author's own submissions with their moderation status ("Under review", hold expiry, decision links). */
export default async function SubmissionsPage() {
  const user = await pageUser("/account/submissions");
  const { items } = await listMyCases(db, user.id, clock.now());
  return (
    <main className="mx-auto max-w-reading px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("submissions.h1")}</h1>
      {items.length === 0 ? <p className="mt-3">{t("submissions.empty")}</p> : (
        <ul className="mt-4 space-y-3">
          {items.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-surface p-3">
              <h2 className="font-semibold">{c.title}</h2>
              <p data-testid="submission-status">{t(`submissions.status.${c.kind}`)}{c.holdExpiresAt ? ` · ${t("notice.holdUntil", { date: dateText(c.holdExpiresAt) })}` : ""}</p>
              <p><Link className="text-link underline" href={`/decisions/${c.id}`}>{t("submissions.details")}<span className="sr-only">: {c.title}</span></Link></p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
