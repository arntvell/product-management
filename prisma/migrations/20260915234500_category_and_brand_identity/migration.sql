-- Categories as a model, and brand identity across channels.
--
-- Additive. Style.category and Colorway.productType are KEPT and dual-written:
-- every existing consumer reads them, and retiring the text columns is a
-- separate decision from introducing the model.

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "mergedIntoId" TEXT,
    "shopifyProductType" TEXT,
    "loomCategory" TEXT,
    "sitooCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryChannelMap" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "externalName" TEXT NOT NULL,
    "externalPath" TEXT,
    "categoryId" TEXT,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryChannelMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandChannelRef" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "externalName" TEXT NOT NULL,
    "externalId" TEXT,
    "brandId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'BRAND',
    "manufacturerId" TEXT,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandChannelRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");
CREATE INDEX "Category_active_archived_idx" ON "Category"("active", "archived");
CREATE INDEX "Category_path_idx" ON "Category"("path");
CREATE UNIQUE INDEX "CategoryChannelMap_system_externalKey_key" ON "CategoryChannelMap"("system", "externalKey");
CREATE INDEX "CategoryChannelMap_categoryId_idx" ON "CategoryChannelMap"("categoryId");
CREATE INDEX "CategoryChannelMap_system_categoryId_idx" ON "CategoryChannelMap"("system", "categoryId");
CREATE UNIQUE INDEX "BrandChannelRef_system_externalKey_key" ON "BrandChannelRef"("system", "externalKey");
CREATE INDEX "BrandChannelRef_brandId_idx" ON "BrandChannelRef"("brandId");
CREATE INDEX "BrandChannelRef_system_externalId_idx" ON "BrandChannelRef"("system", "externalId");

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "normalizedName" TEXT,
                    ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false,
                    ADD COLUMN "mergedIntoId" TEXT;

-- AlterTable
ALTER TABLE "Manufacturer" ADD COLUMN "sitooManufacturerId" TEXT;
CREATE UNIQUE INDEX "Manufacturer_sitooManufacturerId_key" ON "Manufacturer"("sitooManufacturerId");

-- AlterTable
ALTER TABLE "Style" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "Style_categoryId_idx" ON "Style"("categoryId");

-- AlterTable
ALTER TABLE "Colorway" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "Colorway_categoryId_idx" ON "Colorway"("categoryId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CategoryChannelMap" ADD CONSTRAINT "CategoryChannelMap_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrandChannelRef" ADD CONSTRAINT "BrandChannelRef_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrandChannelRef" ADD CONSTRAINT "BrandChannelRef_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Style" ADD CONSTRAINT "Style_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Colorway" ADD CONSTRAINT "Colorway_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
