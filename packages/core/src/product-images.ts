import { z } from "zod";
import { checkReplyPolicy } from "./reply-policy";

/** ADR-0034 D11. Pure rules for product galleries; the DB service lives in apps/web/src/server/product-images.ts. */
export const PRODUCT_IMAGE_MAX = 12;
export const PRODUCT_IMAGE_ALT_MAX = 250;
/** Store-neutral public id of the display master (no extension), equal to the Cloudinary public_id. */
export const productImagePublicId = (assetId: string) => `m/${assetId}/medium`;
/** Seed/placeholder images are served from the web app's own /placeholders folder, whatever the media store is. */
export const PLACEHOLDER_PREFIX = "placeholder/";

export type AltResult = { ok: true; alt: string } | { ok: false; reason: "empty" | "too_long" | "link" | "email" | "markup" | "invisible" };

/** Alt text is mandatory plain text: no URLs, e-mail addresses, markup or invisible characters (reply-policy detectors). */
export function validateAltText(raw: string): AltResult {
  const r = checkReplyPolicy(raw);
  const alt = r.body.replace(/\s+/g, " ");
  if (!alt) return { ok: false, reason: "empty" };
  if ([...alt].length > PRODUCT_IMAGE_ALT_MAX) return { ok: false, reason: "too_long" };
  for (const h of ["link", "email", "markup", "invisible"] as const) if (r.hard.includes(h)) return { ok: false, reason: h };
  return { ok: true, alt };
}

export const altTextSchema = z.string().max(2000).superRefine((v, ctx) => {
  const r = validateAltText(v);
  if (!r.ok) ctx.addIssue({ code: "custom", message: `Alt text is invalid: ${r.reason}` });
}).transform((v) => (validateAltText(v) as { ok: true; alt: string }).alt);

export interface ImageUrlResolver {
  publicBaseUrl?: string;
  publicUrlFor?: (key: string) => string;
}

/** URL is derived, never stored, so switching MEDIA_PUBLIC_STORE needs no data migration. */
export function productImageUrl(publicId: string, format: string, r: ImageUrlResolver): string {
  if (publicId.startsWith(PLACEHOLDER_PREFIX)) return `/placeholders/${publicId.slice(PLACEHOLDER_PREFIX.length)}.${format}`;
  const key = `${publicId}.${format}`;
  return r.publicUrlFor ? r.publicUrlFor(key) : `${(r.publicBaseUrl ?? "").replace(/\/$/, "")}/${key}`;
}

export interface ProductImageRow {
  id: string; productId: string; publicId: string | null; format: string; width: number | null; height: number | null;
  alt: string; position: number; isPrimary: boolean; publishedAt: Date | null; createdAt: Date;
}
export interface PublicImage { url: string; width: number; height: number; alt: string }

const order = (a: ProductImageRow, b: ProductImageRow) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime();
const published = (r: ProductImageRow) => !!(r.publishedAt && r.publicId && r.width && r.height);

/** Public gallery: published images only, ordered by (position, createdAt). */
export function buildGallery(rows: ProductImageRow[], r: ImageUrlResolver): PublicImage[] {
  return rows.filter(published).sort(order).map((x) => ({ url: productImageUrl(x.publicId!, x.format, r), width: x.width!, height: x.height!, alt: x.alt }));
}

/** The published `isPrimary` image, else the published image with the lowest position, else null (a product never shows a broken primary). */
export function pickPrimary(rows: ProductImageRow[], r: ImageUrlResolver): PublicImage | null {
  const pub = rows.filter(published).sort(order);
  const x = pub.find((i) => i.isPrimary) ?? pub[0];
  return x ? { url: productImageUrl(x.publicId!, x.format, r), width: x.width!, height: x.height!, alt: x.alt } : null;
}

/** New order for a reorder request: the requested ids must be exactly the product's current ids. Returns id -> position (0..n-1). */
export function planReorder(currentIds: string[], requested: string[]): Map<string, number> | null {
  if (requested.length !== currentIds.length || new Set(requested).size !== requested.length) return null;
  const cur = new Set(currentIds);
  if (!requested.every((i) => cur.has(i))) return null;
  return new Map(requested.map((id, i) => [id, i]));
}
