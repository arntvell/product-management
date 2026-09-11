-- AlterTable
ALTER TABLE "FieldOwner" ADD COLUMN     "authority" TEXT,
ADD COLUMN     "evidence" TEXT,
ADD COLUMN     "decidedAt" TIMESTAMP(3);
