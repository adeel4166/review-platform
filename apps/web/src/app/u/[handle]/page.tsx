import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { t } from "@/i18n/en";
import { getPublicProfile, listUserReviews } from "@/server/social";
import { optionalUserId } from "@/server/viewer";
import { FollowButton } from "@/components/m6/FollowButton";
import { Stars } from "@/components/Stars";
import { TrustBand } from "@/components/TrustBand";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) { return { title: `@${(await params).handle} · ${t("app.name")}` }; }

/** 06 public profile: band (never the numeric score), counts, follow, published reviews with verified/sort filters. Hidden users are a neutral 404. */
export default async function ProfilePage({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<{ verified?: string; sort?: string }> }) {
  const { handle } = await params;
  const sp = await searchParams;
  const viewer = await optionalUserId();
  let profile, reviews;
  try {
    profile = await getPublicProfile(db, handle, viewer);
    reviews = await listUserReviews(db, handle, viewer, { verified: sp.verified === "1", sort: sp.sort === "helpful" ? "helpful" : "recent" });
  } catch { notFound(); }
  const target = await db.user.findUnique({ where: { handle: profile.handle }, select: { id: true } });
  const follow = viewer && target && viewer !== target.id ? await db.follow.findFirst({ where: { followerId: viewer, followedUserId: target.id }, select: { id: true } }) : null;
  const q = (o: Record<string, string>) => `?${new URLSearchParams({ ...(sp.verified === "1" ? { verified: "1" } : {}), ...(sp.sort ? { sort: sp.sort } : {}), ...o })}`;
  return (
    <main className="mx-auto max-w-content px-4 py-6">
      <h1 className="text-2xl font-semibold">{profile.displayName} <span className="text-text-muted">@{profile.handle}</span></h1>
      <p className="mt-1"><TrustBand band={profile.band} /></p>
      {profile.bio && <p className="mt-2 max-w-reading whitespace-pre-wrap break-words">{profile.bio}</p>}
      <p className="mt-2 text-text-muted">{t("profile.since", { year: profile.memberSinceYear })}</p>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        {(["reviews", "helpfulReceived", "followers", "following"] as const).map((k) => <div key={k}><dt className="inline text-text-muted">{t(`profile.count.${k}`)}: </dt><dd className="inline font-semibold">{profile.counts[k]}</dd></div>)}
      </dl>
      <div className="mt-3">
        {viewer && target && viewer !== target.id ? <FollowButton userId={target.id} handle={profile.handle} followId={follow?.id ?? null} />
          : !viewer ? <Link className="text-link underline" href={`/login?callbackUrl=/u/${profile.handle}`}>{t("profile.signInToFollow")}</Link> : <Link className="text-link underline" href="/account/profile">{t("profile.edit")}</Link>}
      </div>
      <h2 className="mt-6 text-xl font-semibold">{t("profile.reviews")}</h2>
      <nav aria-label={t("profile.filters")} className="mt-2 flex flex-wrap gap-4">
        <Link className="inline-flex min-h-target items-center text-link underline" aria-current={sp.verified !== "1" ? "true" : undefined} href={q({ verified: "0" }).replace("verified=0&", "").replace("?verified=0", "?")}>{t("profile.all")}</Link>
        <Link className="inline-flex min-h-target items-center text-link underline" aria-current={sp.verified === "1" ? "true" : undefined} href={q({ verified: "1" })}>{t("profile.verifiedOnly")}</Link>
        <Link className="inline-flex min-h-target items-center text-link underline" aria-current={sp.sort !== "helpful" ? "true" : undefined} href={q({ sort: "recent" })}>{t("profile.sort.recent")}</Link>
        <Link className="inline-flex min-h-target items-center text-link underline" aria-current={sp.sort === "helpful" ? "true" : undefined} href={q({ sort: "helpful" })}>{t("profile.sort.helpful")}</Link>
      </nav>
      {reviews.items.length === 0 ? <p className="mt-3">{t("profile.noReviews")}</p> : (
        <ul className="mt-3 space-y-3">
          {reviews.items.map((r) => (
            <li key={r.id} className="rounded-lg border border-border bg-surface p-3">
              <h3 className="font-semibold">{r.title}</h3>
              <p className="flex flex-wrap items-center gap-2 text-sm"><Stars value={r.rating} />{r.verified && <span>{t("profile.verified")}</span>}<Link className="text-link underline" href={`/products/${r.product.slug}`}>{r.product.name}</Link></p>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words">{r.body}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
