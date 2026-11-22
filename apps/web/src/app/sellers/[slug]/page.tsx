import Link from "next/link";
import { ProductThumb } from "@/components/ui/ProductCard";
import { notFound } from "next/navigation";
import { SellerVerifiedBadge } from "@/components/seller/SellerVerifiedBadge";
import { db } from "@/server/db";
import { getPublicSeller } from "@/server/seller-views";
import { t } from "@/i18n/en";

export const dynamic = "force-dynamic"; // verification state must never be served from a stale cache

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const s = await getPublicSeller(db, (await params).slug);
  return { title: `${s?.name ?? t("seller.public.unverified")} · ${t("app.name")}` };
}

export default async function PublicSellerPage({ params }: { params: Promise<{ slug: string }> }) {
  const seller = await getPublicSeller(db, (await params).slug);
  if (!seller) notFound();
  return (
    <main className="mx-auto max-w-content px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <h1 className="text-2xl font-bold leading-tight md:text-3xl">{seller.name}</h1>
      <div className="mt-2">
        {seller.verifiedDomain ? (
          <>
            <SellerVerifiedBadge domain={seller.verifiedDomain} />
            <p className="mt-1 text-sm text-text-muted">{t("seller.public.verifiedNote")}</p>
          </>
        ) : (
          <p className="text-text-muted" data-testid="seller-unverified">
            {seller.status === "SUSPENDED" ? t("seller.public.suspended") : seller.status === "PENDING_VERIFICATION" ? t("seller.public.pending") : t("seller.public.unverified")}
          </p>
        )}
      </div>
      {seller.description && <p className="mt-4 max-w-reading whitespace-pre-line">{seller.description}</p>}
      {seller.websiteUrl && /^https?:\/\//i.test(seller.websiteUrl) && (
        <p className="mt-3">{t("seller.public.website")}: <a className="text-link underline" href={seller.websiteUrl} rel="nofollow noopener noreferrer ugc">{seller.websiteUrl}</a></p>
      )}
      <section aria-labelledby="sp-h" className="mt-8">
        <h2 id="sp-h" className="text-xl font-semibold">{t("seller.public.products")}</h2>
        {seller.products.length === 0 ? <p className="mt-2">{t("seller.public.noProducts")}</p> : (
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {seller.products.map((p) => (
              <li key={p.id} className="relative rounded-lg border border-border bg-surface p-4 shadow-sm hover:shadow-md">
                <ProductThumb name={p.name} />
                <h3 className="mt-3 line-clamp-2 text-lg font-semibold leading-tight"><Link className="after:absolute after:inset-0 after:content-[''] hover:underline" href={`/products/${p.slug}`}>{p.name}</Link></h3>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
