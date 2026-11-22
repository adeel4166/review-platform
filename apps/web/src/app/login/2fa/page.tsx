import { safeCallbackUrl } from "@/lib/callback-url";
import { TwoFactorChallenge } from "@/components/account/TwoFactorChallenge";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("tf.challenge.title")} · ${t("app.name")}` };

/** Reachable only with a pending-2FA session (the middleware gate sends everything else here); a missing session just fails the POST. */
export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  return (
    <main className="mx-auto my-8 max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg md:my-16 md:p-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("tf.challenge.title")}</h1>
      <TwoFactorChallenge callbackUrl={callbackUrl} />
    </main>
  );
}
