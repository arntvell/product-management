-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "skipped" JSONB,
ADD COLUMN     "warnings" JSONB;
