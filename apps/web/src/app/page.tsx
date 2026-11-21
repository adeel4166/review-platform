import Link from "next/link";
import { t } from "@/i18n/en";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Review Platform</h1>
      <p className="text-text-muted">Honest, moderated product reviews.</p>
      <p className="mt-4"><Link href="/products" className="text-link underline">{t("nav.products")}</Link></p>
    </main>
  );
}
