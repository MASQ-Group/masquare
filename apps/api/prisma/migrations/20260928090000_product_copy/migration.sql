-- The buyer-facing words, once, in parts a channel can assemble to its own limits.
--
-- A title is the same product said to the same buyer whatever the marketplace; what differs is the
-- room -- eBay stops at 80 characters, OnBuy at 150. Writing it separately per channel meant writing
-- the same sentence again with a different ruler beside it, and every channel added multiplied that.
--
-- Nullable and read only as a fallback: a channel that has its own title or description keeps using
-- it, so nothing already written changes.
ALTER TABLE "product" ADD COLUMN "copy" JSONB;
