-- CreateTable
CREATE TABLE "LoomInboundEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "inboundRef" TEXT,
    "poNumber" TEXT,
    "revision" INTEGER NOT NULL,
    "isCorrection" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "counts" JSONB,
    "unfiled" JSONB,
    "affectedColorwayIds" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "LoomInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoomInboundEvent_eventId_key" ON "LoomInboundEvent"("eventId");

-- CreateIndex
CREATE INDEX "LoomInboundEvent_batchId_revision_idx" ON "LoomInboundEvent"("batchId", "revision");
