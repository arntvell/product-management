-- CreateTable
CREATE TABLE "VintageSourceProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "webCategory" TEXT,
    "retailNok" DECIMAL(10,2),
    "costNok" DECIMAL(10,2),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VintageSourceProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VintageSourceProduct_name_key" ON "VintageSourceProduct"("name");

-- CreateIndex
CREATE INDEX "VintageSourceProduct_category_idx" ON "VintageSourceProduct"("category");

