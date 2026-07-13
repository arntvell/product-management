-- CreateEnum
CREATE TYPE "MediaSource" AS ENUM ('BLOB', 'SHOPIFY', 'THREADFLOW', 'EXTERNAL');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "blobPathname" TEXT,
ADD COLUMN     "source" "MediaSource" NOT NULL DEFAULT 'BLOB';
