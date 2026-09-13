-- Shopify splits identity from stock: a ProductVariant is the listing, an
-- InventoryItem is what inventory moves against, and they are different gids.
-- Loom's stock registry joins on the inventory object, so the master has to
-- carry both. Additive and nullable — nothing depends on it being present, and
-- the registry falls back to barcode where it is absent.
ALTER TABLE "VariantChannelRef" ADD COLUMN "externalInventoryId" TEXT;
