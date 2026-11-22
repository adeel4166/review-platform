/**
 * `pnpm db:seed:demo`: rich, idempotent demo data for staging / live checks (LIVE-01).
 * REFUSES to run when NODE_ENV or APP_ENV is production. Demo account password comes from env DEMO_PASSWORD only (no default, never printed).
 * Idempotent: every row has a deterministic id and is upserted, so a re-run changes nothing except refreshing the demo passwords and cached aggregates.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/password";
import { assertDemoSeedAllowed, DemoSeedRefused } from "./seed-demo-guard";
import { buildDemoData, DEMO_ACCOUNTS } from "./seed-demo-data";

const DAY = 86_400_000;

async function main() {
  const password = assertDemoSeedAllowed(process.env); // before any DB access
  const prisma = new PrismaClient();
  try {
    // eslint-disable-next-line no-restricted-syntax -- CLI seed script, not request-path code
    const now = Date.now();
    const ago = (days: number) => new Date(now - days * DAY);
    const d = buildDemoData();
    const passwordHash = await hashPassword(password);

    // Users (+ staff roles). Only the six role accounts can log in; reviewers and seller owners have no password.
    for (const u of d.users) {
      await prisma.user.upsert({
        where: { id: u.id },
        update: u.login ? { passwordHash } : {},
        create: {
          id: u.id, email: u.email, handle: u.handle, displayName: u.displayName, bio: u.bio || null, emailVerifiedAt: ago(200), status: "ACTIVE",
          passwordHash: u.login ? passwordHash : null, trustBand: u.band, trustScore: { NEW: 10, LOW: 35, MEDIUM: 60, HIGH: 85 }[u.band], trustComputedAt: ago(1),
        },
      });
      if (u.role) await prisma.userRole.upsert({ where: { userId_role: { userId: u.id, role: u.role } }, update: {}, create: { userId: u.id, role: u.role, reason: "demo seed" } });
    }

    const catId = new Map<string, string>();
    for (const c of d.categories) {
      const row = await prisma.category.upsert({ where: { slug: c.slug }, update: {}, create: { id: c.id, slug: c.slug, name: c.name, position: c.position } });
      catId.set(c.slug, row.id);
    }

    // Sellers: verified ones get a VERIFIED seller-scope claim (SEL-011) so the label is backed by data.
    for (const s of d.sellers) {
      await prisma.seller.upsert({
        where: { id: s.id }, update: {},
        create: {
          id: s.id, slug: s.slug, name: s.name, nameSkeleton: s.slug.replace(/-/g, ""), description: s.description, websiteUrl: s.websiteUrl, countryCode: s.countryCode,
          status: "UNVERIFIED", trustBand: s.verified ? "HIGH" : "MEDIUM", trustScore: s.verified ? 82 : 55, trustComputedAt: ago(1), createdById: s.ownerId,
        },
      });
      await prisma.sellerMember.upsert({ where: { sellerId_userId: { sellerId: s.id, userId: s.ownerId } }, update: {}, create: { sellerId: s.id, userId: s.ownerId, role: "OWNER" } });
      if (s.verified) {
        const claimId = `demo_claim_${s.id}`;
        await prisma.sellerOwnershipClaim.upsert({
          where: { id: claimId }, update: {},
          create: { id: claimId, sellerId: s.id, scope: "SELLER", method: "DOCUMENT", status: "VERIFIED", verifiedAt: ago(90), verifiedUntil: new Date(now + 275 * DAY), activeKey: `demo:${s.id}`, submittedById: s.ownerId },
        });
        await prisma.seller.updateMany({ where: { id: s.id, status: "UNVERIFIED" }, data: { status: "VERIFIED", verifiedClaimId: claimId, verifiedAt: ago(90) } });
      }
    }

    for (const p of d.products) {
      await prisma.product.upsert({
        where: { id: p.id }, update: {},
        create: {
          id: p.id, slug: p.slug, name: p.name, brandName: p.brandName, description: p.description, categoryId: catId.get(p.categorySlug)!, gtin: p.gtin, mpn: p.mpn,
          specs: p.specs as never, status: "ACTIVE", createdById: "demo_u_admin", sellerId: p.sellerId,
        },
      });
    }

    // Product images (ADR-0034 D11): placeholder assets, already "public" (CHECK chk_media_public_bucket needs the scan/clearance columns).
    for (const im of d.productImages) {
      const t = ago(0);
      await prisma.mediaAsset.upsert({
        where: { id: im.assetId }, update: {},
        create: {
          id: im.assetId, ownerId: "demo_u_admin", purpose: "PRODUCT_IMAGE", reviewId: null, kind: "IMAGE", status: "READY", bucket: "PUBLIC", declaredMime: "image/svg+xml", detectedMime: "image/svg+xml",
          sizeBytes: 1, ingestKey: "seed", width: im.width, height: im.height, virusScannedAt: t, metadataStripped: true, moderationClearedAt: t, promotedAt: t, processedAt: t,
        },
      });
      await prisma.productImage.upsert({
        where: { id: im.id }, update: {},
        create: { id: im.id, productId: im.productId, mediaAssetId: im.assetId, publicId: im.publicId, format: im.format, width: im.width, height: im.height, alt: im.alt, position: im.position, isPrimary: im.isPrimary, publishedAt: t, createdById: "demo_u_admin" },
      });
    }

    // Reviews, revisions, verified-buyer proofs.
    for (const r of d.reviews) {
      const published = r.status === "PUBLISHED";
      const at = ago(r.ageDays);
      await prisma.review.upsert({
        where: { id: r.id }, update: {},
        create: {
          id: r.id, productId: r.productId, authorId: r.authorId, rating: r.rating, title: r.title, body: r.body, incentive: r.incentive, language: "en", status: r.status,
          currentVersion: 1, publishedVersion: published ? 1 : null, publishedAt: published ? at : null, createdAt: at,
        },
      });
      await prisma.reviewRevision.upsert({
        where: { reviewId_version: { reviewId: r.id, version: 1 } }, update: {},
        create: { reviewId: r.id, version: 1, rating: r.rating, title: r.title, body: r.body, editorId: r.authorId, status: published ? "APPROVED" : r.status === "REJECTED" ? "REJECTED" : "HELD", incentive: r.incentive },
      });
      if (r.verified) {
        const proofId = `demo_proof_${r.id}`;
        await prisma.purchaseProof.upsert({
          where: { id: proofId }, update: {},
          create: {
            id: proofId, reviewId: r.id, submittedById: r.authorId, method: "ORDER_CONFIRMATION", status: "VERIFIED", consentVersion: "v1", consentedAt: ago(r.ageDays + 1),
            submittedAt: ago(r.ageDays + 1), reviewedById: "demo_u_moderator", reviewedAt: ago(r.ageDays), merchantName: "Demo merchant",
          },
        });
        await prisma.review.updateMany({ where: { id: r.id, verifiedPurchaseAt: null }, data: { verifiedBuyer: true, verifiedAt: at, verifiedPurchaseAt: at, verificationMethod: "ORDER_CONFIRMATION", verifiedProofId: proofId } });
      }
    }

    // Votes, then cached helpful counts.
    for (const v of d.votes) {
      await prisma.reviewVote.upsert({ where: { reviewId_userId: { reviewId: v.reviewId, userId: v.userId } }, update: {}, create: { reviewId: v.reviewId, userId: v.userId, value: v.value, weight: 1 } });
    }
    const helpful = new Map<string, number>(), notHelpful = new Map<string, number>();
    for (const v of d.votes) { const m = v.value === "HELPFUL" ? helpful : notHelpful; m.set(v.reviewId, (m.get(v.reviewId) ?? 0) + 1); }
    for (const r of d.reviews) await prisma.review.update({ where: { id: r.id }, data: { helpfulCount: helpful.get(r.id) ?? 0, helpfulWeighted: helpful.get(r.id) ?? 0, notHelpfulCount: notHelpful.get(r.id) ?? 0 } });

    // Seller replies (published).
    for (const rp of d.replies) {
      await prisma.sellerReply.upsert({ where: { id: rp.id }, update: {}, create: { id: rp.id, reviewId: rp.reviewId, sellerId: rp.sellerId, authorId: rp.authorId, body: rp.body, status: "PUBLISHED", publishedAt: ago(1) } });
    }

    // Follows.
    for (const f of d.follows) {
      const target = f.targetType === "USER" ? { followedUserId: f.targetId } : f.targetType === "SELLER" ? { followedSellerId: f.targetId } : { followedProductId: f.targetId };
      const where = f.targetType === "USER" ? { followerId_followedUserId: { followerId: f.followerId, followedUserId: f.targetId } }
        : f.targetType === "SELLER" ? { followerId_followedSellerId: { followerId: f.followerId, followedSellerId: f.targetId } }
        : { followerId_followedProductId: { followerId: f.followerId, followedProductId: f.targetId } };
      await prisma.follow.upsert({ where, update: {}, create: { id: f.id, followerId: f.followerId, targetType: f.targetType, ...target } });
    }

    // Moderation queue and appeal queue.
    for (const c of d.cases) {
      const base = { id: c.id, subjectType: "REVIEW" as const, reviewId: c.reviewId, version: 1, lane: c.lane, aiProvider: "demo", aiReason: c.reason, createdAt: ago(c.resolved ? 6 : 0) };
      const open = c.lane === "HOLD" ? { state: "NEEDS_HUMAN" as const, status: "OPEN" as const, openKey: `HOLD:R:${c.reviewId}`, holdExpiresAt: new Date(now + 3 * DAY), slaDueAt: new Date(now + 2 * DAY), aiVerdict: "UNSURE" as const, trigger: "SUBMISSION" as const }
        : c.lane === "POST_REVIEW" ? { state: "APPROVED" as const, status: "OPEN" as const, openKey: `POST_REVIEW:R:${c.reviewId}`, postReviewDueAt: new Date(now + DAY), aiVerdict: "CLEAN" as const, trigger: "SUBMISSION" as const }
        : { state: "NEEDS_HUMAN" as const, status: "OPEN" as const, openKey: `REPORTED:R:${c.reviewId}`, slaDueAt: new Date(now + 2 * DAY), aiVerdict: "UNSURE" as const, trigger: "USER_REPORT" as const, reportCount: 2, reportWeight: 2 };
      const resolved = { state: "REJECTED" as const, status: "RESOLVED" as const, openKey: null, outcome: "REMOVE" as const, resolutionCode: "VIOLATION", resolvedAt: ago(5), decidedAt: ago(5), decidedById: "demo_u_moderator", appealableUntil: new Date(now + 25 * DAY), aiVerdict: "VIOLATION" as const, trigger: "SUBMISSION" as const };
      await prisma.moderationCase.upsert({ where: { id: c.id }, update: {}, create: { ...base, ...(c.resolved ? resolved : open) } });
    }
    for (const a of d.appeals) {
      await prisma.appeal.upsert({
        where: { id: a.id }, update: {},
        create: { id: a.id, appellantId: a.appellantId, caseId: a.caseId, contentVersion: 1, statement: a.statement, status: "SUBMITTED", slaDueAt: new Date(now + 5 * DAY), submittedAt: ago(1) },
      });
    }

    // Cached rating aggregates (same rules as core aggregate(): PUBLISHED only, half-even is not needed for display at 2 dp).
    for (const p of d.products) {
      const pub = d.reviews.filter((r) => r.productId === p.id && r.status === "PUBLISHED");
      const ver = pub.filter((r) => r.verified);
      const avg = (a: { rating: number }[]) => (a.length ? Math.round((a.reduce((s, r) => s + r.rating, 0) / a.length) * 100) / 100 : null);
      const hist = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
      for (const r of pub) hist[String(r.rating) as keyof typeof hist]++;
      await prisma.product.update({
        where: { id: p.id },
        data: { ratingAverage: avg(pub), ratingCount: pub.length, reviewCount: pub.length, verifiedRatingAverage: avg(ver), verifiedRatingCount: ver.length, ratingHistogram: hist, aggregateComputedAt: new Date(now) },
      });
    }

    console.log(`[seed-demo] ${d.categories.length} categories, ${d.products.length} products, ${d.productImages.length} product images, ${d.reviews.length} reviews, ${d.sellers.length} sellers, ${d.users.length} users, ${d.votes.length} votes, ${d.replies.length} replies, ${d.follows.length} follows, ${d.cases.length} cases, ${d.appeals.length} appeals`);
    console.log(`[seed-demo] login accounts (password = value of DEMO_PASSWORD): ${Object.values(DEMO_ACCOUNTS).join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof DemoSeedRefused ? `[seed-demo] REFUSED: ${e.message}` : `[seed-demo] failed: ${(e as Error).message}`);
  process.exit(1);
});
