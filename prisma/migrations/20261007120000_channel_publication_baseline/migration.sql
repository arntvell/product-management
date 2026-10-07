-- AlterTable
ALTER TABLE "ChannelPublication" ADD COLUMN     "baseline" JSONB,
ADD COLUMN     "baselineAt" TIMESTAMP(3);
