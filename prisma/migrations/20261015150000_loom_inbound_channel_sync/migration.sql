-- AlterTable
ALTER TABLE "LoomInboundEvent" ADD COLUMN     "channelsPushedAt" TIMESTAMP(3),
ADD COLUMN     "channelReport" JSONB;
