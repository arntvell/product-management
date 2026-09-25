-- The creation wizard's saved state. Additive: one table, one enum.

-- CreateEnum
CREATE TYPE "ProductDraftStatus" AS ENUM ('DRAFT', 'FINALIZING', 'COMPLETED', 'DISCARDED');

-- CreateTable
CREATE TABLE "ProductDraft" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProductDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "step" TEXT NOT NULL DEFAULT 'brand',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "brandId" TEXT,
    "seasonId" TEXT,
    "channels" "Channel"[] DEFAULT ARRAY[]::"Channel"[],
    "reservedIds" JSONB,
    "finalizeAttempts" INTEGER NOT NULL DEFAULT 0,
    "startedFinalizeAt" TIMESTAMP(3),
    "finalizeError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdStyleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdColorwayIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductDraft_status_updatedAt_idx" ON "ProductDraft"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "ProductDraft" ADD CONSTRAINT "ProductDraft_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDraft" ADD CONSTRAINT "ProductDraft_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;
