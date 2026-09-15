-- Size systems, and the per-brand SKU token.
--
-- Additive only: two new tables, one new enum, two new nullable columns. The
-- database is shared with production, which runs older code — nothing here
-- changes a column that code reads.

-- CreateEnum
CREATE TYPE "SizeSystemKind" AS ENUM ('ONE_D', 'TWO_D', 'ONE_SIZE');

-- CreateTable
CREATE TABLE "SizeSystem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SizeSystemKind" NOT NULL DEFAULT 'ONE_D',
    "note" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SizeSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SizeSystemEntry" (
    "id" TEXT NOT NULL,
    "sizeSystemId" TEXT NOT NULL,
    "sizeLabel" TEXT NOT NULL,
    "dim1" TEXT NOT NULL,
    "dim2" TEXT,
    "skuToken" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SizeSystemEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SizeSystem_name_key" ON "SizeSystem"("name");

-- CreateIndex
CREATE INDEX "SizeSystemEntry_sizeSystemId_position_idx" ON "SizeSystemEntry"("sizeSystemId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SizeSystemEntry_sizeSystemId_sizeLabel_key" ON "SizeSystemEntry"("sizeSystemId", "sizeLabel");

-- AddForeignKey
ALTER TABLE "SizeSystemEntry" ADD CONSTRAINT "SizeSystemEntry_sizeSystemId_fkey" FOREIGN KEY ("sizeSystemId") REFERENCES "SizeSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "skuToken" TEXT;

-- AlterTable
ALTER TABLE "BrandTemplate" ADD COLUMN "defaultSizeSystemId" TEXT;

-- AddForeignKey
ALTER TABLE "BrandTemplate" ADD CONSTRAINT "BrandTemplate_defaultSizeSystemId_fkey" FOREIGN KEY ("defaultSizeSystemId") REFERENCES "SizeSystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
