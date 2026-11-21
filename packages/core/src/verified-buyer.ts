/** Verified Buyer (ADR-0008). The order source is an adapter so a real shop/PurchaseProof integration can replace the stub. */
export interface PurchaseRecord {
  orderId: string;
  productId: string;
  userId: string;
  purchasedAt: Date;
}

export interface PurchaseLookup {
  findPurchase(userId: string, productId: string): Promise<PurchaseRecord | null>;
}

/** Stub adapter backed by a fixed list; used until an order integration exists. */
export class StubPurchaseLookup implements PurchaseLookup {
  constructor(private readonly records: PurchaseRecord[] = []) {}
  async findPurchase(userId: string, productId: string) {
    return this.records.find((r) => r.userId === userId && r.productId === productId) ?? null;
  }
}

export interface VerifiedBuyerStore {
  findReview(reviewId: string): Promise<{ id: string; authorId: string; productId: string; verifiedBuyer: boolean } | null>;
  setVerified(reviewId: string, orderId: string, at: Date): Promise<void>;
}

/** Marks a review verified if its author has a purchase of that product. Idempotent; returns the resulting flag. */
export async function markVerifiedBuyer(store: VerifiedBuyerStore, lookup: PurchaseLookup, reviewId: string, now = new Date()): Promise<boolean> {
  const r = await store.findReview(reviewId);
  if (!r) return false;
  if (r.verifiedBuyer) return true;
  const p = await lookup.findPurchase(r.authorId, r.productId);
  if (!p || p.userId !== r.authorId || p.productId !== r.productId) return false;
  await store.setVerified(r.id, p.orderId, now);
  return true;
}
