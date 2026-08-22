-- Repricing is bounded by the floor and the max price, and nothing else.
--
-- The MAP on a product card is an informational local-market retail price; it says nothing about
-- what a marketplace listing may be priced at. The column was never populated, and leaving it in
-- place invited wiring the product MAP into it -- which would have clamped every listing to a
-- number that has no bearing on it.
ALTER TABLE "repricing_sku_pricing" DROP COLUMN IF EXISTS "map_cents";
