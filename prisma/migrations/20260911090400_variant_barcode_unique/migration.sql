-- THE ONLY NON-ADDITIVE MIGRATION IN THIS SET.
--
-- Variant.barcode currently holds 22 rows with the placeholder '0' (STORAGE-*
-- SKUs) and one duplicate pair on '7000000023361' (LIV-REPS / LIV-REPSS-OS).
-- 6,009 variants carry a barcode, 5,987 are distinct: these 24 rows are the
-- only obstacle to the unique index.
--
-- Placeholders are nulled rather than deleted — the barcode is absent, which is
-- what NULL means. The repair pair keeps the code on the older row.

-- Null the placeholder barcodes (not real codes; '0' fails EAN-13 validation).
UPDATE "Variant" SET "barcode" = NULL WHERE "barcode" IN ('0', '', ' ');

-- Keep the earliest-created row in any remaining duplicate group; null the rest.
UPDATE "Variant" v SET "barcode" = NULL
WHERE v."barcode" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Variant" w
    WHERE w."barcode" = v."barcode"
      AND (w."createdAt", w."id") < (v."createdAt", v."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "Variant_barcode_key" ON "Variant"("barcode");
