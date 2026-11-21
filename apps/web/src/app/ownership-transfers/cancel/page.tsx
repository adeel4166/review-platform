import { TokenAction } from "@/components/seller/TokenAction";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("own.link.title")} · ${t("app.name")}`, referrer: "no-referrer" };

/** Cancel link from the notification email. No sign-in: the unused token is the credential (T6). */
export default async function CancelByLinkPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("own.link.title")}</h1>
      <p className="mt-2">{t("own.link.lead")}</p>
      <TokenAction urlToken={typeof raw === "string" ? raw : ""} endpoint="/api/ownership-transfers/cancel-by-link"
        labels={{ confirm: "own.link.confirm", done: "own.link.done", invalid: "own.link.invalid" }} />
    </main>
  );
}
