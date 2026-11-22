import { NotificationCenter } from "@/components/m6/NotificationCenter";
import { pageUser } from "@/server/page-auth";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("notif.h1")} · ${t("app.name")}` };
export default async function NotificationsPage() {
  await pageUser("/account/notifications");
  return <main className="mx-auto max-w-content px-4 py-6 md:px-6 md:py-8 lg:px-8"><h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("notif.h1")}</h1><NotificationCenter /></main>;
}
