-- CreateEnum
CREATE TYPE "EntryOrigin" AS ENUM ('NEW', 'CARRYOVER');

-- AlterTable
ALTER TABLE "Colorway" ADD COLUMN     "isCore" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SeasonEntry" ADD COLUMN     "origin" "EntryOrigin" NOT NULL DEFAULT 'NEW';
