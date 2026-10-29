-- CreateEnum
CREATE TYPE "ShootStatus" AS ENUM ('SHOOT', 'BOOKED', 'SHOT', 'SKIP');

-- AlterTable
ALTER TABLE "SeasonEntry" ADD COLUMN     "shootNote" TEXT,
ADD COLUMN     "shootStatus" "ShootStatus",
ADD COLUMN     "shootUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "shootUpdatedBy" TEXT;
