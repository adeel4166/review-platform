import Link from "next/link";
import { t } from "@/i18n/en";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="sr-only">{t("state.notFound.title")}</h1>
      <EmptyState title={t("state.notFound.title")} description={t("state.notFound.body")} action={<Link href="/products" className="inline-flex min-h-target items-center rounded-md bg-primary px-4 font-semibold text-on-primary">{t("nav.products")}</Link>} />
    </main>
  );
}
