import { prisma, type PrismaClient } from "@rp/db";

export type Db = PrismaClient;
export const db: Db = prisma;
