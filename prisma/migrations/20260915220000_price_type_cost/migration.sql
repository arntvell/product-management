-- ALTER TYPE ... ADD VALUE must be the ONLY statement in this migration.
-- Prisma wraps each migration in a transaction, and Postgres forbids *using* a
-- new enum value in the same transaction that adds it. Anything co-located here
-- that referenced 'COST' would fail at deploy.
ALTER TYPE "PriceType" ADD VALUE 'COST';
