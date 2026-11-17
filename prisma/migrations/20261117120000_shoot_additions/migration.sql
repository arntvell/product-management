-- AlterTable
ALTER TABLE "SeasonEntry" ADD COLUMN     "shootPreparedAt" TIMESTAMP(3),
ADD COLUMN     "shootPreparedBy" TEXT;

-- CreateTable
CREATE TABLE "ShootAddition" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "colorwayId" TEXT NOT NULL,
    "status" "ShootStatus",
    "note" TEXT,
    "preparedAt" TIMESTAMP(3),
    "preparedBy" TEXT,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "updatedBy" TEXT,

    CONSTRAINT "ShootAddition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShootAddition_seasonId_colorwayId_key" ON "ShootAddition"("seasonId", "colorwayId");

-- AddForeignKey
ALTER TABLE "ShootAddition" ADD CONSTRAINT "ShootAddition_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootAddition" ADD CONSTRAINT "ShootAddition_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

