-- Per-marketplace channel listings: eBay uses one integration/token across many marketplaces,
-- so a listing now carries its marketplace (ISO country; '' for single-marketplace channels).

-- AlterTable
ALTER TABLE "channel_listing" ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT '';

-- Replace the unique key to include marketplace (same-SKU listings on different eBay sites coexist).
DROP INDEX "channel_listing_integration_id_channel_sku_key";
CREATE UNIQUE INDEX "channel_listing_integration_id_channel_sku_marketplace_key" ON "channel_listing"("integration_id", "channel_sku", "marketplace");
