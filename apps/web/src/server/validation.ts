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
