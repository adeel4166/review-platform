import { z } from "zod";
import { MEDIA_ALLOWED_MIME, MEDIA_MAX_BYTES, PRODUCT_IMAGE_MAX, altTextSchema } from "@rp/core";

const id = z.string().min(1).max(64);

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const productListQuery = pageQuery.extend({
  category: z.string().min(1).max(80).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export const reviewListQuery = pageQuery;

export const reviewInput = z
  .object({
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().min(1).max(150),
    body: z.string().trim().min(10).max(10_000),
  })
  .strict();

export const reviewUpdateInput = reviewInput.partial().strict().refine((v) => Object.keys(v).length > 0, {
  message: "At least one field is required",
});

export const registerInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(10).max(128),
    handle: z.string().regex(/^[a-z0-9_]{3,32}$/, "3-32 chars: a-z, 0-9, _"),
    displayName: z.string().trim().min(1).max(64),
  })
  .strict();

export const loginInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});

export const idParam = id;

export const productImageSlotInput = z.object({
  mimeType: z.enum(MEDIA_ALLOWED_MIME),
  sizeBytes: z.number().int().min(1).max(MEDIA_MAX_BYTES),
  alt: altTextSchema,
}).strict();
export const productImagePatchInput = z.object({ alt: altTextSchema.optional(), isPrimary: z.literal(true).optional() }).strict()
  .refine((v) => v.alt !== undefined || v.isPrimary !== undefined, { message: "Nothing to update" });
export const productImageOrderInput = z.object({ imageIds: z.array(id).min(1).max(PRODUCT_IMAGE_MAX) }).strict();
export const productImageDecisionInput = z.object({ decision: z.enum(["approve", "reject"]) }).strict();
export type ReviewInput = z.infer<typeof reviewInput>;

export const moderationQueueQuery = pageQuery.extend({
  state: z.enum(["PENDING", "AI_REVIEW", "NEEDS_HUMAN", "APPROVED", "REJECTED"]).default("NEEDS_HUMAN"),
  productId: id.optional(),
  subjectType: z.enum(["REVIEW", "SELLER_REPLY"]).default("REVIEW"),
  trigger: z.enum(["SUBMISSION", "EDIT", "USER_REPORT"]).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  maxScore: z.coerce.number().min(0).max(1).optional(),
  hasMedia: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

export const auditQuery = pageQuery.extend({ entityId: id.optional() });

export const approveInput = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict();
export const rejectInput = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const STAFF_ROLES = ["MODERATOR", "SENIOR_MODERATOR", "ADMIN", "SUPER_ADMIN"] as const;
export const staffRoleInput = z.object({ role: z.enum(STAFF_ROLES), reason: z.string().trim().min(3).max(255) }).strict();
export const staffRoleRevokeInput = z.object({ role: z.enum(STAFF_ROLES) }).strict();
export type RegisterInput = z.infer<typeof registerInput>;

// M3-04. `.strict()` rejects any client-supplied sellerId / role escalation fields (AZ-010, P-2).
export const sellerCreateInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and dashes").min(2).max(80).optional(),
    description: z.string().trim().max(5000).optional(),
    websiteUrl: z.string().trim().url().max(2048).regex(/^https?:\/\//i, "http(s) only").optional(),
    countryCode: z.string().regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase()).optional(),
  })
  .strict();

export const invitationInput = z
  .object({ email: z.string().trim().toLowerCase().email().max(254), role: z.enum(["MANAGER", "RESPONDER"]) })
  .strict();

export const invitationAcceptInput = z.object({ token: z.string().min(20).max(128) }).strict();

export const sellerSuspendInput = z
  .object({
    reasonCode: z.string().regex(/^[A-Z0-9_]{3,64}$/),
    publicReason: z.string().trim().min(3).max(2000),
    endsAt: z.coerce.date().optional(),
  })
  .strict();

// M3-05 ownership claims. `.strict()`: the seller comes from the path, never the body (AZ-010).
const claimBase = z
  .object({
    scope: z.enum(["SELLER", "PRODUCT"]),
    method: z.enum(["DNS_TXT", "META_TAG", "BUSINESS_EMAIL_DOMAIN", "DOCUMENT", "MARKETPLACE"]),
    domain: z.string().trim().min(3).max(253).optional(),
    productId: id.optional(),
    evidenceUrl: z.string().trim().url().max(2048).regex(/^https:\/\//i, "https only").optional(),
    businessEmail: z.string().trim().toLowerCase().email().max(254).optional(),
  })
  .strict();
export const claimSubmitInput = claimBase.superRefine((v, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (v.scope === "PRODUCT" && !v.productId) bad("productId", "productId is required for PRODUCT scope"); // SEL-012
  if (v.scope === "SELLER" && v.productId) bad("productId", "productId is only allowed for PRODUCT scope");
  if (v.scope === "PRODUCT" && v.method !== "DOCUMENT" && v.method !== "MARKETPLACE") bad("method", "PRODUCT claims use DOCUMENT or MARKETPLACE");
  if ((v.method === "DNS_TXT" || v.method === "META_TAG") && !v.domain) bad("domain", "domain is required for this method");
  if (v.method === "BUSINESS_EMAIL_DOMAIN" && !v.businessEmail) bad("businessEmail", "businessEmail is required");
  if (v.method === "MARKETPLACE" && !v.evidenceUrl) bad("evidenceUrl", "evidenceUrl is required for MARKETPLACE");
});

export const claimQueueQuery = pageQuery.extend({
  tab: z.enum(["review", "contested", "spot_check"]).default("review"),
});
export const claimDecisionInput = z
  .object({
    action: z.enum(["approve", "reject", "request_info", "revoke", "spot_check_pass", "spot_check_fail"]),
    reasonCode: z.string().regex(/^[A-Z0-9_]{3,64}$/).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

/** m3b-spec 3.4: the seller id comes from the path; the body is strict and never carries it. */
const outcome = z.enum(["BECOME_MANAGER", "BECOME_RESPONDER", "REMOVED"]);
export const transferCreateInput = z
  .object({ kind: z.enum(["ADD_OWNER", "TRANSFER", "REMOVE_OWNER"]), targetUserId: z.string().min(1).max(191), initiatorOutcome: outcome.optional(), targetOutcome: outcome.optional() })
  .strict();
export const transferTokenInput = z.object({ token: z.string().min(20).max(128) }).strict();
export const transferStaffCancelInput = z.object({ reasonCode: z.string().regex(/^[A-Z0-9_]{2,40}$/) }).strict();
export const claimEmailTokenInput = z.object({ token: z.string().min(20).max(128) }).strict();

/** Reply body only: the seller, product and review come from the path and the server (P-2). Length is policed by checkReplyPolicy. */
export const replyInput = z.object({ body: z.string().max(6000) }).strict();

export const replyListQuery = pageQuery.extend({
  status: z.enum(["PENDING", "PUBLISHED", "HIDDEN", "REJECTED", "REMOVED", "DELETED"]).optional(),
});

export const replyRemoveInput = z.object({ reasonCode: z.string().regex(/^[A-Z0-9_]{3,64}$/) }).strict();

export const replyRestrictionInput = z
  .object({
    reasonCode: z.string().regex(/^[A-Z0-9_]{3,64}$/),
    publicReason: z.string().trim().min(3).max(2000),
    endsAt: z.coerce.date().optional(),
  })
  .strict();

// ---- M4 (m4-m5-spec) ----
import { REPORT_REASONS, REMOVAL_REASON_CODES, PROOF_DECISION_REASONS } from "@rp/core";

export const voteInput = z.object({ value: z.enum(["HELPFUL", "NOT_HELPFUL"]) }).strict();

export const INCENTIVE_VALUES = ["NONE", "FREE_PRODUCT", "DISCOUNT", "PAYMENT", "OTHER"] as const;

export const reviewEditInput = z.object({
  expectedVersion: z.number().int().min(1),
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().trim().min(1).max(150).optional(),
  body: z.string().trim().min(10).max(10_000).optional(),
  incentive: z.enum(INCENTIVE_VALUES).optional(),
  addMediaIds: z.array(id).max(10).optional(),
  removeMediaIds: z.array(id).max(10).optional(),
}).strict().refine((v) => Object.keys(v).some((k) => k !== "expectedVersion"), { message: "At least one field is required" });

export const reportInput = z.object({ reason: z.enum(REPORT_REASONS), details: z.string().trim().min(1).max(1000).optional() }).strict();
export const dismissReportsInput = z.object({ note: z.string().trim().max(500).optional() }).strict();
export const removeContentInput = z.object({ reasonCode: z.enum(REMOVAL_REASON_CODES), publicReason: z.string().trim().min(1, "reason_required").max(2000) }).strict();

export const proofCreateInput = z.object({
  method: z.enum(["RECEIPT_UPLOAD", "ORDER_CONFIRMATION", "MARKETPLACE_ORDER_LINK"]),
  consentVersion: z.string().max(16),
  marketplace: z.enum(["AMAZON", "EBAY", "ETSY", "OTHER"]).optional(),
  orderReference: z.string().trim().min(1).max(64).optional(),
}).strict();
export const proofFileInput = z.object({ kind: z.enum(["IMAGE", "DOCUMENT"]), mimeType: z.string().max(64), sizeBytes: z.number().int().min(1) }).strict();
export const proofDecisionInput = z.object({
  outcome: z.enum(["VERIFIED", "REJECTED"]),
  reasonCode: z.enum(PROOF_DECISION_REASONS).optional(),
  note: z.string().trim().max(500).optional(),
}).strict();
export const labelRevokeInput = z.object({ reasonCode: z.string().trim().min(1).max(64), publicReason: z.string().trim().min(1).max(2000) }).strict();

/** Staff decision on a flagged/quarantined media asset (M5-02). `approve` = retry processing, `reject` = close and purge. */
export const mediaDecisionInput = z.object({ decision: z.enum(["approve", "reject"]) }).strict();
