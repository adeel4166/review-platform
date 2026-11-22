import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getImageResolver } from "@/server/storage";
import { auth } from "@/server/auth";
import { getProduct } from "@/server/products";
import { HttpError } from "@/server/http";
import { ReviewForm } from "@/components/ReviewForm";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("product.writeReview")} · ${t("app.name")}` };

export default async function WriteReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(db, slug, getImageResolver()).catch((e) => { if (e instanceof HttpError && e.status === 404) return null; throw e; });
  if (!product) notFound();
  const href = `/products/${product.slug}`;
  const session = await auth();
  return (
    <main className="mx-auto max-w-content px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{t("form.title", { product: product.name })}</h1>
      <div className="mt-6 max-w-2xl rounded-xl border border-border bg-surface p-4 shadow-md md:p-6">
        {session?.user?.id ? (
          <ReviewForm productId={product.id} productName={product.name} productHref={href} />
        ) : (
          <p role="status">
            {t("form.signin.required")}{" "}
            <Link className="text-link underline" href={`/login?callbackUrl=${encodeURIComponent(`${href}/review`)}`}>{t("form.signin.link")}</Link>
          </p>
        )}
      </div>
    </main>
  );
}
