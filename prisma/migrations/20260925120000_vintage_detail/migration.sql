-- CreateTable
CREATE TABLE "VintageDetail" (
    "colorwayId" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "measurementType" TEXT NOT NULL,
    "category" TEXT,
    "taggedSize" TEXT,
    "approxSize" TEXT,
    "chestWidth" TEXT,
    "frontLength" TEXT,
    "waist" TEXT,
    "frontRise" TEXT,
    "inseam" TEXT,
    "originalBrand" TEXT,
    "sourceProduct" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VintageDetail_pkey" PRIMARY KEY ("colorwayId")
);

-- CreateIndex
CREATE INDEX "VintageDetail_itemNumber_idx" ON "VintageDetail"("itemNumber");

-- AddForeignKey
ALTER TABLE "VintageDetail" ADD CONSTRAINT "VintageDetail_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

