import { t } from "@/i18n/en";
import { VerifyEmailForm } from "@/components/VerifyEmailForm";

export const metadata = { title: `${t("verify.title")} · ${t("app.name")}`, referrer: "no-referrer" };

/** GET never consumes the token (mail scanners prefetch links): the button POSTs it. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("verify.title")}</h1>
      <VerifyEmailForm token={typeof raw === "string" ? raw : ""} />
    </main>
  );
}
