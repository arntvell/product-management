-- The push queue, and the Loom identity stamp. Additive.

-- CreateTable
CREATE TABLE "PushBatch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "seasonCode" TEXT,
    "channels" "Channel"[] DEFAULT ARRAY[]::"Channel"[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "allowIncomplete" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "draftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "colorwayId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "externalId" TEXT,
    "eventId" TEXT,
    "jobId" TEXT,
    "error" TEXT,
    "detail" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PushBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushBatch_status_idx" ON "PushBatch"("status");
CREATE INDEX "PushBatch_kind_createdAt_idx" ON "PushBatch"("kind", "createdAt");
CREATE INDEX "PushBatch_draftId_idx" ON "PushBatch"("draftId");
CREATE UNIQUE INDEX "PushBatchItem_batchId_colorwayId_channel_key" ON "PushBatchItem"("batchId", "colorwayId", "channel");
CREATE INDEX "PushBatchItem_batchId_channel_state_idx" ON "PushBatchItem"("batchId", "channel", "state");
CREATE INDEX "PushBatchItem_colorwayId_idx" ON "PushBatchItem"("colorwayId");

-- AlterTable
ALTER TABLE "ChannelPublication" ADD COLUMN "loomIdentityPushedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "PushBatchItem" ADD CONSTRAINT "PushBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PushBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushBatchItem" ADD CONSTRAINT "PushBatchItem_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
