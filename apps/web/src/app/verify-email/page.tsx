import { t } from "@/i18n/en";
import { VerifyEmailForm } from "@/components/VerifyEmailForm";

export const metadata = { title: `${t("verify.title")} · ${t("app.name")}`, referrer: "no-referrer" };

/** GET never consumes the token (mail scanners prefetch links): the button POSTs it. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  return (
    <main className="mx-auto my-8 max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg md:my-16 md:p-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("verify.title")}</h1>
      <VerifyEmailForm token={typeof raw === "string" ? raw : ""} />
    </main>
  );
}
