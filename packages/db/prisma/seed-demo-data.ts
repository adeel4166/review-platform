/**
 * Deterministic demo dataset (LIVE-01). Pure: no database, no clock, no env. Same output on every call, so the seed can upsert by id.
 * Fake content only; every address is on the reserved example domain `demo.example`.
 */
export type Role = "MODERATOR" | "SENIOR_MODERATOR" | "ADMIN" | "SUPER_ADMIN";
export interface DemoCategory { id: string; slug: string; name: string; position: number }
export interface DemoSeller { id: string; slug: string; name: string; description: string; websiteUrl: string; countryCode: string; verified: boolean; domain: string; ownerId: string }
export interface DemoProduct { id: string; slug: string; name: string; brandName: string; description: string; categorySlug: string; sellerId: string; gtin: string; mpn: string; specs: Record<string, unknown> }
export interface DemoUser { id: string; email: string; handle: string; displayName: string; bio: string; band: "NEW" | "LOW" | "MEDIUM" | "HIGH"; role?: Role; login: boolean; sellerOwnerOf?: string }
export interface DemoReview {
  id: string; productId: string; authorId: string; rating: number; title: string; body: string;
  status: "PUBLISHED" | "PENDING" | "REJECTED"; verified: boolean; ageDays: number; incentive: "NONE" | "FREE_PRODUCT" | "DISCOUNT";
}
export interface DemoProductImage { id: string; assetId: string; productId: string; publicId: string; format: "svg"; width: number; height: number; alt: string; position: number; isPrimary: boolean }
export interface DemoVote { reviewId: string; userId: string; value: "HELPFUL" | "NOT_HELPFUL" }
export interface DemoReply { id: string; reviewId: string; sellerId: string; authorId: string; body: string }
export interface DemoFollow { id: string; followerId: string; targetType: "USER" | "SELLER" | "PRODUCT"; targetId: string }
export interface DemoCase { id: string; reviewId: string; lane: "HOLD" | "POST_REVIEW" | "REPORTED"; resolved: boolean; reason: string }
export interface DemoAppeal { id: string; caseId: string; appellantId: string; statement: string }
export interface DemoData {
  categories: DemoCategory[]; sellers: DemoSeller[]; products: DemoProduct[]; productImages: DemoProductImage[]; users: DemoUser[]; reviews: DemoReview[];
  votes: DemoVote[]; replies: DemoReply[]; follows: DemoFollow[]; cases: DemoCase[]; appeals: DemoAppeal[];
}

function rng(seed: number) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type SpecRange = [key: string, min: number, max: number, decimals: number];
const CATALOGUE: { slug: string; name: string; brands: string[]; items: string[]; specs: SpecRange[]; noun: string }[] = [
  { slug: "electronics", name: "Electronics", noun: "device", brands: ["Auralis", "Voltix", "Nimbus"], items: ["Noise-Cancelling Headphones", "Bluetooth Speaker", "Wireless Earbuds", "Smart Watch", "Portable Power Bank"], specs: [["batteryHours", 6, 48, 0], ["weightGrams", 40, 420, 0], ["priceUsd", 29, 349, 0], ["warrantyMonths", 6, 36, 0]] },
  { slug: "home-kitchen", name: "Home & Kitchen", noun: "appliance", brands: ["Hearth", "Kettleby", "Brightline"], items: ["Espresso Maker", "Air Fryer", "Stand Mixer", "Cast Iron Skillet", "Robot Vacuum"], specs: [["powerWatts", 400, 1800, 0], ["capacityLiters", 1, 6, 1], ["weightKg", 1, 9, 1], ["priceUsd", 25, 499, 0]] },
  { slug: "books", name: "Books", noun: "book", brands: ["Lantern Press", "Orchard House", "Quill & Co"], items: ["Learning SQL", "The Quiet Garden", "Systems Thinking Handbook", "A Brief History of Tea", "Cooking by Numbers"], specs: [["pages", 120, 780, 0], ["publishYear", 2008, 2026, 0], ["priceUsd", 9, 69, 0], ["editionNumber", 1, 5, 0]] },
  { slug: "sports-outdoors", name: "Sports & Outdoors", noun: "piece of gear", brands: ["Ridgeway", "Trailhead", "Summit & Sons"], items: ["Trail Running Shoes", "Two-Person Tent", "Insulated Water Bottle", "Yoga Mat", "Hiking Backpack"], specs: [["weightGrams", 150, 2800, 0], ["capacityLiters", 1, 55, 0], ["priceUsd", 18, 289, 0], ["warrantyMonths", 6, 60, 0]] },
  { slug: "beauty", name: "Beauty & Personal Care", noun: "product", brands: ["Verdant", "Luma", "Palette Lab"], items: ["Vitamin C Serum", "Mineral Sunscreen SPF 50", "Hydrating Face Cream", "Electric Toothbrush", "Hair Dryer"], specs: [["volumeMl", 15, 250, 0], ["priceUsd", 8, 199, 0], ["spf", 0, 50, 0], ["crueltyFree", 0, 1, 0]] },
  { slug: "toys-games", name: "Toys & Games", noun: "toy", brands: ["Pebble Play", "Gizmo Guild", "Tabletop Tales"], items: ["Wooden Building Blocks", "Strategy Board Game", "Remote Control Car", "1000-Piece Puzzle", "Kids Art Set"], specs: [["minAgeYears", 3, 14, 0], ["players", 1, 6, 0], ["priceUsd", 10, 129, 0], ["pieces", 20, 1500, 0]] },
  { slug: "office", name: "Office & Productivity", noun: "office item", brands: ["Deskly", "Inkwell", "Ergon"], items: ["Ergonomic Office Chair", "Standing Desk", "Mechanical Keyboard", "Webcam 1080p", "Noise-Masking Desk Lamp"], specs: [["weightKg", 0.3, 28, 1], ["priceUsd", 22, 599, 0], ["warrantyMonths", 12, 120, 0], ["adjustable", 0, 1, 0]] },
  { slug: "pet-supplies", name: "Pet Supplies", noun: "pet product", brands: ["Whisker & Paw", "Barkley", "Tailwind"], items: ["Orthopedic Dog Bed", "Automatic Cat Feeder", "Grain-Free Dog Food", "Cat Scratching Post", "Reflective Dog Leash"], specs: [["weightKg", 0.2, 15, 1], ["priceUsd", 6, 149, 0], ["petSizeKg", 2, 45, 0], ["washable", 0, 1, 0]] },
];

const SELLERS: [name: string, country: string, verified: boolean, blurb: string][] = [
  ["Northwind Trading", "US", true, "Family-run retailer of home and outdoor goods since 2009."],
  ["Bluebird Books & Gifts", "GB", true, "Independent bookshop and gift supplier."],
  ["Kestrel Electronics", "DE", true, "Authorised reseller of consumer electronics."],
  ["Maple & Moss", "CA", false, "Small-batch beauty and home products."],
  ["Plaything Planet", "AU", false, "Toys and games for all ages."],
  ["Harbor Office Supply", "US", false, "Office furniture and stationery."],
];

const REVIEWER_NAMES = ["Alex Rivera", "Sam Okafor", "Jordan Lee", "Priya Nair", "Morgan Ellis", "Taylor Brooks", "Casey Novak", "Riley Chen", "Jamie Fox", "Devon Park", "Avery Stone", "Quinn Murphy", "Harper Diaz", "Rowan Kim", "Sage Patel", "Emery Walsh", "Finley Cruz", "Skyler Moon", "Kai Johansson", "Reese Adams", "Noel Bauer", "Blair Santos", "Drew Hayes", "Ellis Grant", "Frankie Ross", "Gale Mercer", "Hollis Ward", "Indy Vale", "Jules Mora", "Kit Larsen"];

const OPENERS: Record<number, string[]> = {
  5: ["Absolutely love this {noun}.", "Exceeded my expectations.", "Best purchase I have made this year.", "Five stars, no hesitation."],
  4: ["Very good overall.", "Happy with it, with small caveats.", "Solid {noun} for the price.", "Does what it promises."],
  3: ["It is fine, nothing special.", "Mixed feelings about this one.", "Average {noun}.", "Works, but I expected a bit more."],
  2: ["Disappointed after a few weeks.", "Not great for the price.", "Several things bother me.", "Below what the listing suggested."],
  1: ["Would not recommend.", "Stopped working quickly.", "Poor quality and poor value.", "Returned it after a week."],
};
const DETAILS: Record<number, string[]> = {
  5: ["Build quality is excellent and it has been reliable every day.", "Setup took minutes and the results speak for themselves.", "Great value; I have already recommended it to friends."],
  4: ["Quality is good, though the instructions could be clearer.", "Minor niggles with the finish, otherwise great.", "Delivery was quick and it matches the description."],
  3: ["Some features are great, others feel unfinished.", "Okay for occasional use but I would not rely on it daily.", "Price is fair but there are alternatives."],
  2: ["It feels cheaper than the photos suggest and one part already looks worn.", "Customer support was slow to respond.", "Performance is inconsistent."],
  1: ["It broke within days and the replacement was no better.", "Materials feel flimsy and the description was misleading.", "Waste of money; I want a refund."],
};
const TITLES: Record<number, string[]> = {
  5: ["Fantastic", "Worth every penny", "Highly recommended", "A joy to use"],
  4: ["Pretty good", "Good value", "Recommended with caveats", "Happy customer"],
  3: ["It is okay", "Average", "Mixed bag", "Decent but flawed"],
  2: ["Disappointing", "Not as described", "Expected better", "Meh"],
  1: ["Do not buy", "Broke quickly", "Terrible", "Regret buying"],
};
const REPLIES = [
  "Thank you for the feedback. We are sorry this fell short; please contact our support team with your order number and we will make it right.",
  "We appreciate you taking the time to review. We have passed your comments to our product team.",
  "Sorry to hear about your experience. A replacement is available under warranty; reach out to us and we will arrange it.",
];

const slugify = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pick = <T,>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
/** Self-contained placeholder image (data URI SVG), so the demo needs no external image host or uploaded files. */
export function placeholderImage(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="hsl(${hue},45%,88%)"/><circle cx="300" cy="170" r="70" fill="hsl(${hue},45%,70%)"/><text x="300" y="320" font-family="sans-serif" font-size="26" text-anchor="middle" fill="hsl(${hue},40%,25%)">${label.replace(/[<>&"']/g, "")}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const DEMO_ACCOUNTS = {
  user: "demo.user@demo.example", seller: "demo.seller@demo.example", moderator: "demo.moderator@demo.example",
  seniorModerator: "demo.senior-moderator@demo.example", admin: "demo.admin@demo.example", superAdmin: "demo.super-admin@demo.example",
} as const;

export function buildDemoData(): DemoData {
  const r = rng(20261122);
  const categories: DemoCategory[] = CATALOGUE.map((c, i) => ({ id: `demo_cat_${c.slug}`, slug: c.slug, name: c.name, position: i }));

  // --- users: 6 role accounts, 5 seller-owner accounts (no password), 30 reviewers (no password) ---
  const users: DemoUser[] = [
    { id: "demo_u_user", email: DEMO_ACCOUNTS.user, handle: "demo_user", displayName: "Demo User", bio: "Demo shopper account.", band: "MEDIUM", login: true },
    { id: "demo_u_seller", email: DEMO_ACCOUNTS.seller, handle: "demo_seller", displayName: "Demo Seller", bio: "Owner of Northwind Trading (demo).", band: "HIGH", login: true, sellerOwnerOf: "demo_seller_0" },
    { id: "demo_u_moderator", email: DEMO_ACCOUNTS.moderator, handle: "demo_moderator", displayName: "Demo Moderator", bio: "Staff demo account.", band: "HIGH", role: "MODERATOR", login: true },
    { id: "demo_u_senior", email: DEMO_ACCOUNTS.seniorModerator, handle: "demo_senior_mod", displayName: "Demo Senior Moderator", bio: "Staff demo account.", band: "HIGH", role: "SENIOR_MODERATOR", login: true },
    { id: "demo_u_admin", email: DEMO_ACCOUNTS.admin, handle: "demo_admin", displayName: "Demo Admin", bio: "Staff demo account.", band: "HIGH", role: "ADMIN", login: true },
    { id: "demo_u_superadmin", email: DEMO_ACCOUNTS.superAdmin, handle: "demo_super_admin", displayName: "Demo Super Admin", bio: "Staff demo account.", band: "HIGH", role: "SUPER_ADMIN", login: true },
  ];
  const sellers: DemoSeller[] = SELLERS.map(([name, countryCode, verified, description], i) => {
    const slug = slugify(name);
    const ownerId = i === 0 ? "demo_u_seller" : `demo_u_owner_${i}`;
    if (i > 0) users.push({ id: ownerId, email: `owner${i}@demo.example`, handle: `demo_owner_${i}`, displayName: `${name} Owner`, bio: `Owner of ${name} (demo).`, band: "MEDIUM", login: false, sellerOwnerOf: `demo_seller_${i}` });
    return { id: `demo_seller_${i}`, slug, name, description, websiteUrl: `https://${slug}.demo.example`, countryCode, verified, domain: `${slug}.demo.example`, ownerId };
  });
  const reviewers = REVIEWER_NAMES.map((n, i): DemoUser => ({
    id: `demo_u_rev_${String(i + 1).padStart(2, "0")}`, email: `reviewer${i + 1}@demo.example`, handle: `demo_rev_${i + 1}`, displayName: n,
    bio: i % 3 === 0 ? "Gadget fan and occasional reviewer." : "", band: (["NEW", "LOW", "MEDIUM", "HIGH"] as const)[i % 4]!, login: false,
  }));
  users.push(...reviewers);

  // --- products: 5 per category, 40 total, category-consistent numeric specs so comparison works ---
  const products: DemoProduct[] = [];
  CATALOGUE.forEach((c, ci) => c.items.forEach((item, ii) => {
    const n = ci * 5 + ii;
    const brandName = c.brands[ii % c.brands.length]!;
    const name = c.slug === "books" ? item : `${brandName} ${item}`;
    const specs: Record<string, unknown> = {};
    for (const [key, min, max, dec] of c.specs) specs[key] = Number((min + r() * (max - min)).toFixed(dec));
    specs.imageUrl = placeholderImage(name, (n * 37) % 360);
    specs.imageAlt = `Placeholder illustration of ${name}`;
    const digits = String(2_000_000_000_000 + n * 7919).padStart(13, "0");
    products.push({
      id: `demo_prod_${String(n + 1).padStart(2, "0")}`, slug: slugify(name), name, brandName,
      description: `${name}: a demo ${c.noun} used to showcase reviews, trust scores and comparison. Specifications are illustrative.`,
      categorySlug: c.slug, sellerId: sellers[n % sellers.length]!.id, gtin: digits, mpn: `DEMO-${String(n + 1).padStart(3, "0")}`, specs,
    });
  }));

  // --- reviews: 5 per product (distinct authors) = 200. Ratings skew positive like real review data. ---
  const nounOf = new Map(CATALOGUE.map((c) => [c.slug, c.noun]));
  const reviews: DemoReview[] = [];
  const ratingFor = () => { const x = r(); return x < 0.36 ? 5 : x < 0.66 ? 4 : x < 0.81 ? 3 : x < 0.93 ? 2 : 1; };
  products.forEach((p, pi) => {
    for (let k = 0; k < 5; k++) {
      const author = reviewers[(pi * 7 + k * 5 + k) % reviewers.length]!;
      const rating = ratingFor();
      const noun = nounOf.get(p.categorySlug)!;
      const body = `${pick(r, OPENERS[rating]!).replace("{noun}", noun)} ${pick(r, DETAILS[rating]!)} ${pick(r, DETAILS[rating]!)}`;
      reviews.push({
        id: `demo_rev_${String(reviews.length + 1).padStart(3, "0")}`, productId: p.id, authorId: author.id, rating, title: pick(r, TITLES[rating]!), body,
        status: "PUBLISHED", verified: r() < 0.35, ageDays: 3 + Math.floor(r() * 150), incentive: r() < 0.06 ? "FREE_PRODUCT" : "NONE",
      });
    }
  });
  // Demo user has own published, verified review on the first product, and pending/rejected items for the queues (replacing generated ones).
  const reviewOf = (id: string) => reviews.find((x) => x.id === id)!;
  Object.assign(reviewOf("demo_rev_001"), { authorId: "demo_u_user", verified: true, rating: 4, title: "Great sound, average battery", body: "Comfortable for long sessions and the noise cancelling works well on the train. Battery could last longer." });
  // Moderation queue: 3 held (pending), 1 post-review, 1 reported published review; 2 rejected with appeals.
  for (const id of ["demo_rev_010", "demo_rev_025", "demo_rev_040"]) { const x = reviewOf(id); x.status = "PENDING"; x.verified = false; x.ageDays = 0; }
  reviewOf("demo_rev_010").body = "Honestly this is a scam, anyone buying should visit http://cheap-deals.example and https://win-free.example instead.";
  reviewOf("demo_rev_010").rating = 1;
  for (const id of ["demo_rev_060", "demo_rev_075"]) { const x = reviewOf(id); x.status = "REJECTED"; x.verified = false; x.ageDays = 6; x.rating = 1; x.body = "This seller is awful and the owner is a fraud, avoid at all costs and report them."; x.title = "Awful"; }
  for (const x of reviews) if (x.status !== "PUBLISHED") x.verified = false;

  const cases: DemoCase[] = [
    ...["demo_rev_010", "demo_rev_025", "demo_rev_040"].map((id, i) => ({ id: `demo_case_hold_${i + 1}`, reviewId: id, lane: "HOLD" as const, resolved: false, reason: i === 0 ? "AI flagged: spam and link" : "AI unsure" })),
    { id: "demo_case_post_1", reviewId: "demo_rev_100", lane: "POST_REVIEW", resolved: false, reason: "Post-review sample" },
    { id: "demo_case_reported_1", reviewId: "demo_rev_120", lane: "REPORTED", resolved: false, reason: "User report: harassment" },
    ...["demo_rev_060", "demo_rev_075"].map((id, i) => ({ id: `demo_case_rejected_${i + 1}`, reviewId: id, lane: "HOLD" as const, resolved: true, reason: "Removed: harassment" })),
  ];
  const appeals: DemoAppeal[] = ["demo_rev_060", "demo_rev_075"].map((id, i) => ({
    id: `demo_appeal_${i + 1}`, caseId: `demo_case_rejected_${i + 1}`, appellantId: reviewOf(id).authorId,
    statement: "I believe my review was honest and described my real experience; please re-check the decision.",
  }));

  // --- votes: 0..4 per published review, from other reviewers ---
  const votes: DemoVote[] = [];
  for (const rv of reviews.filter((x) => x.status === "PUBLISHED")) {
    const n = Math.floor(r() * 5);
    const used = new Set<string>([rv.authorId]);
    for (let i = 0; i < n; i++) {
      const voter = pick(r, reviewers);
      if (used.has(voter.id)) continue;
      used.add(voter.id);
      votes.push({ reviewId: rv.id, userId: voter.id, value: r() < 0.85 ? "HELPFUL" : "NOT_HELPFUL" });
    }
  }

  // --- seller replies on ~25 published reviews of rating <= 3 (and some praised ones), by the product's seller owner ---
  const productById = new Map(products.map((p) => [p.id, p]));
  const sellerById = new Map(sellers.map((s) => [s.id, s]));
  const replies: DemoReply[] = [];
  for (const rv of reviews.filter((x) => x.status === "PUBLISHED" && (x.rating <= 3 || r() < 0.08))) {
    if (replies.length >= 28) break;
    const s = sellerById.get(productById.get(rv.productId)!.sellerId)!;
    replies.push({ id: `demo_reply_${String(replies.length + 1).padStart(3, "0")}`, reviewId: rv.id, sellerId: s.id, authorId: s.ownerId, body: REPLIES[replies.length % REPLIES.length]! });
  }

  // --- follows ---
  const follows: DemoFollow[] = [];
  const addFollow = (followerId: string, targetType: DemoFollow["targetType"], targetId: string) => {
    if (targetType === "USER" && targetId === followerId) return;
    const id = `demo_follow_${follows.length + 1}`;
    if (!follows.some((f) => f.followerId === followerId && f.targetType === targetType && f.targetId === targetId)) follows.push({ id, followerId, targetType, targetId });
  };
  for (const s of sellers.slice(0, 3)) addFollow("demo_u_user", "SELLER", s.id);
  for (const p of products.slice(0, 4)) addFollow("demo_u_user", "PRODUCT", p.id);
  for (const u of reviewers.slice(0, 3)) addFollow("demo_u_user", "USER", u.id);
  reviewers.forEach((u, i) => { addFollow(u.id, "USER", reviewers[(i + 1) % reviewers.length]!.id); if (i % 2 === 0) addFollow(u.id, "SELLER", sellers[i % sellers.length]!.id); });

  // --- product images (V3-04): two licence-free placeholder illustrations per product, served from apps/web/public/placeholders (no network, no third-party licence). ---
  const productImages: DemoProductImage[] = products.flatMap((p, i) => [1, 2].map((k): DemoProductImage => ({
    id: `demo_img_${String(i + 1).padStart(2, "0")}_${k}`, assetId: `demo_imgasset_${String(i + 1).padStart(2, "0")}_${k}`, productId: p.id,
    publicId: `placeholder/${p.categorySlug}-${k}`, format: "svg", width: 1024, height: 1024,
    alt: k === 1 ? `${p.name} product photo placeholder, front view` : `${p.name} product photo placeholder, detail view`, position: k - 1, isPrimary: k === 1,
  })));
  return { categories, sellers, products, productImages, users, reviews, votes, replies, follows, cases, appeals };
}
