-- CreateTable
CREATE TABLE "FlatRequest" (
    "id" TEXT NOT NULL,
    "colorwayId" TEXT NOT NULL,
    "note" TEXT,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mediaId" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "uploadedBy" TEXT,
    "doneAt" TIMESTAMP(3),
    "shopifyFileId" TEXT,
    "shopifyError" TEXT,

    CONSTRAINT "FlatRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlatRequest_doneAt_idx" ON "FlatRequest"("doneAt");

-- CreateIndex
CREATE INDEX "FlatRequest_colorwayId_idx" ON "FlatRequest"("colorwayId");

-- AddForeignKey
ALTER TABLE "FlatRequest" ADD CONSTRAINT "FlatRequest_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
