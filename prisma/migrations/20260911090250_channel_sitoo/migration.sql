-- AlterEnum
-- Split into its own migration: ALTER TYPE ... ADD VALUE cannot be used by
-- other statements in the same transaction.
ALTER TYPE "Channel" ADD VALUE 'SITOO';
