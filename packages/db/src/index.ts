import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };

/** Singleton client (avoids exhausting connections under Next.js hot reload). */
export const prisma: PrismaClient = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

export * from "@prisma/client";
