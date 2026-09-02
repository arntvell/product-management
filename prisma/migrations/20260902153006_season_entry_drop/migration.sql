-- AlterTable
ALTER TABLE "SeasonEntry" ADD COLUMN     "drop" TEXT;

-- CreateIndex
CREATE INDEX "SeasonEntry_seasonId_drop_idx" ON "SeasonEntry"("seasonId", "drop");
