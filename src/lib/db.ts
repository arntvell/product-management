// Prisma client singleton for the product master.
//
// Prisma 7 connects through a driver adapter. We use the POOLED Vercel Postgres
// (Neon) connection for the app runtime; migrations use the direct connection
// (see prisma.config.ts). The singleton guard prevents connection exhaustion
// from hot-reload in development.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString = process.env.ORIGO_POSTGRES_PRISMA_URL;

if (!connectionString) {
  throw new Error(
    "Missing ORIGO_POSTGRES_PRISMA_URL — pull it from Vercel (`vercel env pull`) or set it in .env.local"
  );
}

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
