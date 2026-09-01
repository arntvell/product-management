-- CreateEnum
CREATE TYPE "MediaRole" AS ENUM ('GALLERY', 'FLAT', 'MEN', 'WOMEN', 'SWATCH');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "role" "MediaRole" NOT NULL DEFAULT 'GALLERY';
