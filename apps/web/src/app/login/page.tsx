import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { t } from "@/i18n/en";
import { safeCallbackUrl } from "@/lib/callback-url";
import { LoginForm } from "@/components/AuthForm";

export const metadata = { title: `${t("login.title")} · ${t("app.name")}` };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  if ((await auth())?.user?.id) redirect(callbackUrl);
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
      <LoginForm callbackUrl={callbackUrl} />
    </main>
  );
}
