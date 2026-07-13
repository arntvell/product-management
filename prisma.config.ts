// Prisma CLI config (migrations, introspection, studio).
// Env is loaded from .env.local (Vercel Postgres vars pulled via `vercel env pull`).
// The CLI uses the NON-POOLED (direct) connection; the app runtime uses the
// POOLED connection through a driver adapter (see src/lib/db.ts).
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.ORIGO_POSTGRES_URL_NON_POOLING,
  },
});
