import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { auth } from "@/server/auth";
import { getProduct } from "@/server/products";
import { listPublishedReviews } from "@/server/reviews";
import { getStorage } from "@/server/storage";
import { HttpError } from "@/server/http";
import { SellerReplyBox, type OwnReply } from "@/components/seller/SellerReplyBox";
import { Pagination } from "@/components/Pagination";
import { ReviewCard } from "@/components/ReviewCard";
import { Stars } from "@/components/Stars";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 10;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

async function load(slug: string) {
  try { return await getProduct(db, slug); } catch (e) { if (e instanceof HttpError && e.status === 404) return null; throw e; }
}

/** Reply UI context for the signed-in user: only members of the product's verified seller (and not the review authors) see it. */
async function loadReplyContext(productId: string, userId: string, reviewIds: string[]) {
  const p = await db.product.findUnique({ where: { id: productId }, select: { sellerId: true, seller: { select: { name: true, status: true } } } });
  if (!p?.sellerId || !p.seller || p.seller.status !== "VERIFIED") return null;
  const member = await db.sellerMember.findUnique({ where: { sellerId_userId: { sellerId: p.sellerId, userId } }, select: { role: true } });
  if (!member) return null;
  const rows = await db.sellerReply.findMany({
    where: { sellerId: p.sellerId, reviewId: { in: reviewIds }, status: { not: "DELETED" } },
    select: { id: true, reviewId: true, status: true, body: true },
  });
  return { sellerName: p.seller.name, replies: new Map<string, OwnReply>(rows.map((r) => [r.reviewId, { id: r.id, status: r.status as OwnReply["status"], body: r.body }])) };
}

export async function generateMetadata({ params }: Props) {
  const p = await load((await params).slug);
  return { title: p ? `${p.name} · ${t("app.name")}` : t("app.name") };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const product = await load((await params).slug);
  if (!product) notFound();
  const page = Math.max(1, Math.min(10_000, parseInt((await searchParams).page ?? "1", 10) || 1));
  const [reviews, session] = await Promise.all([listPublishedReviews(db, product.id, page, PAGE_SIZE, getStorage()), auth()]);
  const pending = session?.user?.id
    ? await db.review.findFirst({ where: { productId: product.id, authorId: session.user.id, status: "PENDING" }, select: { id: true } })
    : null;
  // Seller members of a VERIFIED seller get a reply composer per review (the API re-checks everything, incl. 2FA and restrictions).
  const own = session?.user?.id ? await loadReplyContext(product.id, session.user.id, reviews.items.map((r) => r.id)) : null;
  const avg = Number(product.ratingAverage);
  const pages = Math.max(1, Math.ceil(reviews.total / PAGE_SIZE));
  const specs = product.specs && typeof product.specs === "object" && !Array.isArray(product.specs) ? Object.entries(product.specs as Record<string, unknown>) : [];
  const base = `/products/${product.slug}`;
  return (
    <main className="mx-auto max-w-content px-4 py-6">
      <nav aria-label="Breadcrumb" className="text-sm text-text-muted">
        <Link href="/products" className="underline">{t("nav.products")}</Link> › {product.category.name}
      </nav>
      <h1 className="mt-2 text-2xl font-semibold">{product.name}</h1>
      <p className="text-text-muted">{product.brandName}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {product.ratingCount > 0 ? (
          <p className="flex items-center gap-2"><Stars value={avg} /><span aria-hidden="true" className="text-xl font-semibold">{avg.toFixed(1)}</span><span className="text-text-muted">{t("products.reviews", { count: product.reviewCount })}</span></p>
        ) : <p className="text-text-muted">{t("products.noRatings")}</p>}
        <Link href={`${base}/review`} className="inline-flex min-h-target items-center rounded-md bg-primary px-4 text-on-primary hover:bg-primary-hover">{t("product.writeReview")}</Link>
      </div>
      {product.description && <p className="mt-4 max-w-reading">{product.description}</p>}
      {specs.length > 0 && (
        <section aria-labelledby="specs" className="mt-6">
          <h2 id="specs" className="text-xl font-semibold">{t("product.specs")}</h2>
          <dl className="mt-2 grid max-w-reading grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
            {specs.map(([k, v]) => (<div key={k} className="contents"><dt className="text-text-muted">{k}</dt><dd>{String(v)}</dd></div>))}
          </dl>
        </section>
      )}
      <section aria-labelledby="reviews" className="mt-8">
        <h2 id="reviews" className="text-xl font-semibold">{t("product.reviewsHeading")}</h2>
        {pending && <p role="status" className="mt-3 rounded-md bg-info-bg p-3 text-info">{t("product.pendingNotice")}</p>}
        {reviews.items.length === 0 ? (
          <p className="mt-4">{t("product.noReviews")} <Link className="text-link underline" href={`${base}/review`}>{t("product.beFirst")}</Link></p>
        ) : (
          <div className="mt-4 grid gap-4">
            {reviews.items.map((r) => (
              <ReviewCard key={r.id} review={own?.replies.has(r.id) ? { ...r, reply: null } : r} replyBox={own && (own.replies.has(r.id) || !r.reply)
                ? <SellerReplyBox reviewId={r.id} reviewer={r.author.displayName} sellerName={own.sellerName} initial={own.replies.get(r.id) ?? null} />
                : undefined} />
            ))}
          </div>
        )}
        <Pagination page={page} pages={pages} href={(p) => `${base}?page=${p}#reviews`} />
      </section>
    </main>
  );
}
