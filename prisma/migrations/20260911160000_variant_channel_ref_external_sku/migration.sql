-- AlterTable
ALTER TABLE "VariantChannelRef" ADD COLUMN     "externalSku" TEXT;

-- CreateIndex
CREATE INDEX "VariantChannelRef_externalSku_idx" ON "VariantChannelRef"("externalSku");
