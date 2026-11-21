import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { auth } from "@/server/auth";
import { getProduct } from "@/server/products";
import { HttpError } from "@/server/http";
import { ReviewForm } from "@/components/ReviewForm";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
export const metadata = { title: `${t("product.writeReview")} · ${t("app.name")}` };

export default async function WriteReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(db, slug).catch((e) => { if (e instanceof HttpError && e.status === 404) return null; throw e; });
  if (!product) notFound();
  const href = `/products/${product.slug}`;
  const session = await auth();
  return (
    <main className="mx-auto max-w-content px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("form.title", { product: product.name })}</h1>
      <div className="mt-6">
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
