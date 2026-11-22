import { auth } from "@/server/auth";
import { AcceptInvitation } from "@/components/seller/AcceptInvitation";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("invite.title")} · ${t("app.name")}`, referrer: "no-referrer" };

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const signedIn = !!(await auth())?.user?.id;
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-lg border border-border bg-surface p-5 shadow-sm sm:p-6">
      <h1 className="text-2xl font-semibold">{t("invite.title")}</h1>
      <p className="mt-2">{t("invite.lead")}</p>
      <AcceptInvitation token={token} signedIn={signedIn} />
    </div>
    </main>
  );
}
