import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { t } from "@/i18n/en";
import { safeCallbackUrl } from "@/lib/callback-url";
import { RegisterForm } from "@/components/AuthForm";

export const metadata = { title: `${t("register.title")} · ${t("app.name")}` };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  if ((await auth())?.user?.id) redirect(callbackUrl);
  return (
    <main className="mx-auto my-8 max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg md:my-16 md:p-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("register.title")}</h1>
      <RegisterForm callbackUrl={callbackUrl} />
    </main>
  );
}
