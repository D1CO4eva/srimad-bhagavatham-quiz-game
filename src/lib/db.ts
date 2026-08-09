import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Explicit pool sizing rather than the pg driver's defaults — a burst of
// concurrent requests (players joining/answering at once) is this app's
// normal traffic shape, not an edge case (Story 9.3 load testing).
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 10_000,
});

export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
