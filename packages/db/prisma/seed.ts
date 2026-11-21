import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/password";

// Idempotent dev/demo seed. Passwords come from env (SEED_ADMIN_PASSWORD / SEED_USER_PASSWORD);
// if unset a random one is generated and printed once. Nothing secret is committed.
const prisma = new PrismaClient();

function pw(name: string): string {
  const v = process.env[name];
  if (v) return v;
  const gen = randomBytes(12).toString("base64url");
  console.log(`[seed] ${name} not set; generated: ${gen}`);
  return gen;
}

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      handle: "admin",
      displayName: "Admin",
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(pw("SEED_ADMIN_PASSWORD")),
      roles: { create: { role: "ADMIN", reason: "seed" } },
    },
  });
  const user = await prisma.user.upsert({
    where: { email: "user@example.com" },
    update: {},
    create: {
      email: "user@example.com",
      handle: "demo_user",
      displayName: "Demo User",
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(pw("SEED_USER_PASSWORD")),
    },
  });

  const categories = [
    { slug: "electronics", name: "Electronics" },
    { slug: "home-kitchen", name: "Home & Kitchen" },
    { slug: "books", name: "Books" },
  ];
  const cats: Record<string, string> = {};
  for (const [i, c] of categories.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: { ...c, position: i },
    });
    cats[c.slug] = row.id;
  }

  const products = [
    { slug: "acme-noise-cancelling-headphones", name: "Acme Noise-Cancelling Headphones", brandName: "Acme", category: "electronics" },
    { slug: "acme-espresso-maker", name: "Acme Espresso Maker", brandName: "Acme", category: "home-kitchen" },
    { slug: "learning-sql-3rd-edition", name: "Learning SQL, 3rd Edition", brandName: null, category: "books" },
  ];
  for (const p of products) {
    const { category, ...rest } = p;
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: {},
      create: { ...rest, categoryId: cats[category]!, status: "ACTIVE", createdById: admin.id },
    });
  }

  const headphones = await prisma.product.findUniqueOrThrow({ where: { slug: products[0]!.slug } });
  await prisma.review.upsert({
    where: { productId_authorId: { productId: headphones.id, authorId: user.id } },
    update: {},
    create: {
      productId: headphones.id,
      authorId: user.id,
      rating: 4,
      title: "Great sound, average battery",
      body: "Comfortable for long sessions and the noise cancelling works well on the train.",
      status: "PUBLISHED",
      publishedVersion: 1,
      publishedAt: new Date(),
      // Seeded so the E2E suite can check the Verified buyer badge without an order integration (ADR-0008).
      verifiedBuyer: true,
      verifiedAt: new Date(),
      revisions: {
        create: { version: 1, rating: 4, title: "Great sound, average battery",
          body: "Comfortable for long sessions and the noise cancelling works well on the train.",
          editorId: user.id, status: "APPROVED" },
      },
    },
  });
}

main().finally(() => prisma.$disconnect());
