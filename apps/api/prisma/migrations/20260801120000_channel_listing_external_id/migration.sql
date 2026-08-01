-- The marketplace's own identifier for a listing/product (eBay ItemID, Amazon ASIN, OnBuy OPC).
-- eBay needs the ItemID to revise quantity on classic (ItemID-tracked) listings, which reject the
-- seller SKU as an identifier; also surfaced on the product card.
ALTER TABLE "channel_listing" ADD COLUMN "external_listing_id" TEXT;
