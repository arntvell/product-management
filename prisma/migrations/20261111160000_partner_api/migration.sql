-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "loomBrandId" TEXT;

-- AlterTable
ALTER TABLE "ProductDraft" ADD COLUMN     "loomKey" TEXT;

-- CreateTable
CREATE TABLE "PartnerToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCall" (
    "id" TEXT NOT NULL,
    "tokenName" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "items" INTEGER,
    "ok" INTEGER,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "ms" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerToken_name_key" ON "PartnerToken"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerToken_tokenHash_key" ON "PartnerToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PartnerCall_tokenName_createdAt_idx" ON "PartnerCall"("tokenName", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_loomBrandId_key" ON "Brand"("loomBrandId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDraft_loomKey_key" ON "ProductDraft"("loomKey");

