import { auth } from "@/server/auth";
import { TokenAction } from "@/components/seller/TokenAction";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("claimemail.title")} · ${t("app.name")}`, referrer: "no-referrer" };

/** Business-email claim link. Confirming needs the submitting account to be signed in; "This wasn't me" works from the mailbox alone. */
export default async function ClaimEmailVerifyPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  const signedIn = !!(await auth())?.user?.id;
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("claimemail.title")}</h1>
      <p className="mt-2">{t("claimemail.lead")}</p>
      <TokenAction urlToken={typeof raw === "string" ? raw : ""} endpoint="/api/claims/email-verify" denyEndpoint="/api/claims/email-verify/deny"
        signInHref={signedIn ? undefined : `/login?callbackUrl=${encodeURIComponent("/claims/email-verify")}`}
        labels={{ confirm: "claimemail.confirm", deny: "claimemail.deny", done: "claimemail.done", denied: "claimemail.denied", invalid: "claimemail.invalid" }} />
    </main>
  );
}
