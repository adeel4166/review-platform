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
import { OwnReviewActions, type OwnReviewInfo } from "@/components/OwnReviewActions";
import { VerifiedFilter } from "@/components/VerifiedFilter";
import { PROOF_CONSENT_VERSION } from "@rp/core";
import { Stars } from "@/components/Stars";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 10;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string; verified?: string }> };

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

/** The viewer's own reviews among `ids` with their version and proofs, for the edit / proof-of-purchase block. */
async function loadOwn(userId: string, ids: string[]): Promise<Map<string, OwnReviewInfo>> {
  if (ids.length === 0) return new Map();
  const [mine, proofs] = await Promise.all([
    db.review.findMany({ where: { id: { in: ids }, authorId: userId }, select: { id: true, currentVersion: true, verifiedPurchaseAt: true } }),
    db.purchaseProof.findMany({ where: { reviewId: { in: ids }, review: { authorId: userId } }, orderBy: { createdAt: "desc" }, select: { id: true, reviewId: true, status: true, method: true, decisionReasonCode: true } }),
  ]);
  return new Map(mine.map((m) => [m.id, {
    version: m.currentVersion, verified: !!m.verifiedPurchaseAt, consentVersion: PROOF_CONSENT_VERSION,
    proofs: proofs.filter((p) => p.reviewId === m.id).map((p) => ({ id: p.id, status: p.status, method: p.method, decisionReasonCode: p.decisionReasonCode ?? null })),
  }]));
}

export async function generateMetadata({ params }: Props) {
  const p = await load((await params).slug);
  return { title: p ? `${p.name} · ${t("app.name")}` : t("app.name") };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const product = await load((await params).slug);
  if (!product) notFound();
  const page = Math.max(1, Math.min(10_000, parseInt((await searchParams).page ?? "1", 10) || 1));
  const verifiedOnly = (await searchParams).verified === "1";
  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  const reviews = await listPublishedReviews(db, product.id, page, PAGE_SIZE, getStorage(), { verifiedOnly, viewerId });
  const pending = viewerId
    ? await db.review.findFirst({ where: { productId: product.id, authorId: viewerId, status: "PENDING" }, select: { id: true, rating: true, title: true, body: true } })
    : null;
  const ownInfo = viewerId ? await loadOwn(viewerId, [...reviews.items.map((r) => r.id), ...(pending ? [pending.id] : [])]) : new Map<string, OwnReviewInfo>();
  // Seller members of a VERIFIED seller get a reply composer per review (the API re-checks everything, incl. 2FA and restrictions).
  const own = session?.user?.id ? await loadReplyContext(product.id, session.user.id, reviews.items.map((r) => r.id)) : null;
  const avg = Number(product.ratingAverage);
  const pages = Math.max(1, Math.ceil(reviews.total / PAGE_SIZE));
  const here = `/products/${product.slug}`;
  const viewer = { signedIn: !!viewerId, loginHref: `/login?callbackUrl=${encodeURIComponent(here)}` };
  const qs = (p: number, v: boolean) => { const q = new URLSearchParams(); if (v) q.set("verified", "1"); if (p > 1) q.set("page", String(p)); const s = q.toString(); return `${here}${s ? `?${s}` : ""}`; };
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
        {pending && ownInfo.get(pending.id) && <OwnReviewActions level={3} reviewId={pending.id} rating={pending.rating} title={pending.title} body={pending.body} own={ownInfo.get(pending.id)!} />}
        {reviews.verified.of > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-4" role="group" aria-label={t("product.filters")}>
            <p data-testid="verified-share" className="text-text-muted">{t("product.verifiedShare", { count: reviews.verified.count, of: reviews.verified.of })}</p>
            <VerifiedFilter on={verifiedOnly} href={qs(1, !verifiedOnly)} />
          </div>
        )}
        <p role="status" className="sr-only">{verifiedOnly ? t("product.showingVerified", { count: reviews.total }) : t("product.showing", { count: reviews.total })}</p>
        {reviews.items.length === 0 && verifiedOnly ? (
          <p className="mt-4">{t("product.noVerified")} <Link className="text-link underline" href={qs(1, false)}>{t("product.clearFilter")}</Link></p>
        ) : reviews.items.length === 0 ? (
          <p className="mt-4">{t("product.noReviews")} <Link className="text-link underline" href={`${base}/review`}>{t("product.beFirst")}</Link></p>
        ) : (
          <div className="mt-4 grid gap-4">
            {reviews.items.map((r) => (
              <ReviewCard key={r.id} viewer={viewer} review={own?.replies.has(r.id) ? { ...r, reply: null } : r}
                ownBox={ownInfo.get(r.id) ? <OwnReviewActions reviewId={r.id} rating={r.rating} title={r.title} body={r.body} own={ownInfo.get(r.id)!} /> : undefined} replyBox={own && (own.replies.has(r.id) || !r.reply)
                ? <SellerReplyBox reviewId={r.id} reviewer={r.author.displayName} sellerName={own.sellerName} initial={own.replies.get(r.id) ?? null} />
                : undefined} />
            ))}
          </div>
        )}
        <Pagination page={page} pages={pages} href={(p) => `${qs(p, verifiedOnly)}#reviews`} />
      </section>
    </main>
  );
}
