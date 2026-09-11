-- CreateTable
CREATE TABLE "BarcodeAllocation" (
    "id" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "barcode" TEXT NOT NULL,
    "sku" TEXT,
    "authority" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarcodeAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BarcodeAllocation_barcode_key" ON "BarcodeAllocation"("barcode");

-- CreateIndex
CREATE INDEX "BarcodeAllocation_sku_idx" ON "BarcodeAllocation"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "BarcodeAllocation_range_sequence_key" ON "BarcodeAllocation"("range", "sequence");
