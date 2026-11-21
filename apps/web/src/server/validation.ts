import { z } from "zod";

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
export type ReviewInput = z.infer<typeof reviewInput>;

export const moderationQueueQuery = pageQuery.extend({
  state: z.enum(["PENDING", "AI_REVIEW", "NEEDS_HUMAN", "APPROVED", "REJECTED"]).default("NEEDS_HUMAN"),
  productId: id.optional(),
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
