-- CreateEnum
CREATE TYPE "Source" AS ENUM ('THREADFLOW', 'MANUAL', 'SHOPIFY_IMPORT');

-- CreateEnum
CREATE TYPE "SeasonKind" AS ENUM ('REGULAR', 'CONTINUITY');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('MSRP', 'WHOLESALE');

-- CreateEnum
CREATE TYPE "ImageSlot" AS ENUM ('MAIN', 'ALT');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('SHOPIFY', 'LOOM');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isLivid" BOOLEAN NOT NULL DEFAULT false,
    "gender" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" TEXT NOT NULL,
    "threadflowId" TEXT,
    "name" TEXT NOT NULL,
    "addrLine1" TEXT,
    "addrLine2" TEXT,
    "zip" TEXT,
    "city" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "threadflowId" TEXT,
    "kind" "SeasonKind" NOT NULL DEFAULT 'REGULAR',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Style" (
    "id" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "threadflowId" TEXT,
    "styleSku" TEXT NOT NULL,
    "styleName" TEXT NOT NULL,
    "gender" TEXT,
    "unisex" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL DEFAULT 'Uncategorized',
    "brandId" TEXT,
    "hsCode" TEXT,
    "customsDescription" TEXT,
    "weightKg" DECIMAL(8,3),
    "fiberComposition" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Style_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Colorway" (
    "id" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "threadflowId" TEXT,
    "colorwaySku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "swatchHex" TEXT,
    "swatchImageUrl" TEXT,
    "productType" TEXT,
    "styleId" TEXT NOT NULL,
    "brandId" TEXT,
    "manufacturerId" TEXT,
    "countryOfOrigin" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "tags" TEXT[],
    "vendor" TEXT,
    "hsCodeOverride" TEXT,
    "customsDescriptionOverride" TEXT,
    "weightKgOverride" DECIMAL(8,3),
    "fiberCompositionOverride" TEXT,
    "shortDescription" TEXT,
    "fullDescription" TEXT,
    "details" TEXT,
    "styleTagline" TEXT,
    "styleName" TEXT,
    "sameProduct" TEXT[],
    "styleWith" TEXT[],
    "styleWithUnisexHerre" TEXT[],
    "styleWithUnisexDame" TEXT[],
    "carePageId" TEXT,
    "fitguidePageId" TEXT,
    "recommendedCollectionId" TEXT,
    "modelInfoId" TEXT,
    "flatFileId" TEXT,
    "menImages" TEXT[],
    "womenImages" TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Colorway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "colorwayId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL,
    "barcode" TEXT,
    "sizeLabel" TEXT NOT NULL,
    "dim1" TEXT NOT NULL,
    "dim2" TEXT,
    "averageCostNok" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonEntry" (
    "id" TEXT NOT NULL,
    "colorwayId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "approvedForProduction" BOOLEAN NOT NULL DEFAULT false,
    "merchPosition" INTEGER,

    CONSTRAINT "SeasonEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonVariant" (
    "seasonEntryId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,

    CONSTRAINT "SeasonVariant_pkey" PRIMARY KEY ("seasonEntryId","variantId")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "colorwayId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "priceType" "PriceType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonImage" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "colorwayId" TEXT NOT NULL,
    "slot" "ImageSlot" NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "SeasonImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "colorwayId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
    "position" INTEGER NOT NULL,
    "shopifyMediaId" TEXT,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelPublication" (
    "id" TEXT NOT NULL,
    "colorwayId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "lastPushedAt" TIMESTAMP(3),
    "lastPushStatus" TEXT,

    CONSTRAINT "ChannelPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelContent" (
    "id" TEXT NOT NULL,
    "colorwayId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ChannelContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldOwner" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "owner" "Source" NOT NULL,
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "FieldOwner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "seasonCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "counts" JSONB,
    "errors" JSONB,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_threadflowId_key" ON "Manufacturer"("threadflowId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_code_key" ON "Season"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Season_threadflowId_key" ON "Season"("threadflowId");

-- CreateIndex
CREATE UNIQUE INDEX "Style_threadflowId_key" ON "Style"("threadflowId");

-- CreateIndex
CREATE UNIQUE INDEX "Style_styleSku_key" ON "Style"("styleSku");

-- CreateIndex
CREATE INDEX "Style_brandId_idx" ON "Style"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "Colorway_threadflowId_key" ON "Colorway"("threadflowId");

-- CreateIndex
CREATE UNIQUE INDEX "Colorway_colorwaySku_key" ON "Colorway"("colorwaySku");

-- CreateIndex
CREATE INDEX "Colorway_styleId_idx" ON "Colorway"("styleId");

-- CreateIndex
CREATE INDEX "Colorway_brandId_idx" ON "Colorway"("brandId");

-- CreateIndex
CREATE INDEX "Colorway_manufacturerId_idx" ON "Colorway"("manufacturerId");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_variantSku_key" ON "Variant"("variantSku");

-- CreateIndex
CREATE INDEX "Variant_colorwayId_idx" ON "Variant"("colorwayId");

-- CreateIndex
CREATE INDEX "SeasonEntry_seasonId_idx" ON "SeasonEntry"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonEntry_colorwayId_seasonId_key" ON "SeasonEntry"("colorwayId", "seasonId");

-- CreateIndex
CREATE INDEX "SeasonVariant_variantId_idx" ON "SeasonVariant"("variantId");

-- CreateIndex
CREATE INDEX "Price_colorwayId_idx" ON "Price"("colorwayId");

-- CreateIndex
CREATE UNIQUE INDEX "Price_seasonId_colorwayId_currency_priceType_key" ON "Price"("seasonId", "colorwayId", "currency", "priceType");

-- CreateIndex
CREATE INDEX "SeasonImage_colorwayId_idx" ON "SeasonImage"("colorwayId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonImage_seasonId_colorwayId_slot_key" ON "SeasonImage"("seasonId", "colorwayId", "slot");

-- CreateIndex
CREATE INDEX "MediaAsset_colorwayId_idx" ON "MediaAsset"("colorwayId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPublication_colorwayId_channel_key" ON "ChannelPublication"("colorwayId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelContent_colorwayId_channel_field_key" ON "ChannelContent"("colorwayId", "channel", "field");

-- CreateIndex
CREATE INDEX "FieldOwner_entityType_entityId_idx" ON "FieldOwner"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldOwner_entityType_entityId_field_key" ON "FieldOwner"("entityType", "entityId", "field");

-- AddForeignKey
ALTER TABLE "Style" ADD CONSTRAINT "Style_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Colorway" ADD CONSTRAINT "Colorway_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Colorway" ADD CONSTRAINT "Colorway_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Colorway" ADD CONSTRAINT "Colorway_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonEntry" ADD CONSTRAINT "SeasonEntry_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonEntry" ADD CONSTRAINT "SeasonEntry_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonVariant" ADD CONSTRAINT "SeasonVariant_seasonEntryId_fkey" FOREIGN KEY ("seasonEntryId") REFERENCES "SeasonEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonVariant" ADD CONSTRAINT "SeasonVariant_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonImage" ADD CONSTRAINT "SeasonImage_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonImage" ADD CONSTRAINT "SeasonImage_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPublication" ADD CONSTRAINT "ChannelPublication_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelContent" ADD CONSTRAINT "ChannelContent_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
