-- CreateTable
CREATE TABLE "VariantChannelRef" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "lastPushedAt" TIMESTAMP(3),
    "lastPushStatus" TEXT,

    CONSTRAINT "VariantChannelRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VariantChannelRef_channel_externalId_idx" ON "VariantChannelRef"("channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantChannelRef_variantId_channel_key" ON "VariantChannelRef"("variantId", "channel");

-- AddForeignKey
ALTER TABLE "VariantChannelRef" ADD CONSTRAINT "VariantChannelRef_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
