-- CreateTable
CREATE TABLE "VintageDropDraft" (
    "id" TEXT NOT NULL,
    "drop" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "notice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VintageDropDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VintageDropDraft_drop_key" ON "VintageDropDraft"("drop");

-- CreateTable
CREATE TABLE "VintageBrand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VintageBrand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VintageBrand_name_key" ON "VintageBrand"("name");

-- Seed: every maker already on a vintage garment, from the Shopify tags and
-- VintageDetail.originalBrand. Drop tags and the storefront's own flags are
-- not brands.
INSERT INTO "VintageBrand" ("id", "name", "updatedAt")
SELECT 'vb_' || md5(name), name, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT btrim(t) AS name
    FROM "Colorway" c, unnest(c.tags) AS t
   WHERE c."colorwaySku" LIKE 'VN-ONLN-%'
     AND t !~* '^DROP'
     AND lower(btrim(t)) NOT IN ('rocket-hide', 'hide', 'vintage')
  UNION
  SELECT DISTINCT btrim("originalBrand")
    FROM "VintageDetail"
   WHERE "originalBrand" IS NOT NULL AND btrim("originalBrand") <> ''
) s
WHERE name <> ''
ON CONFLICT ("name") DO NOTHING;
