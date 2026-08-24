-- The price a new offer launches at.
--
-- It could not come from anywhere before: the builder read it off an existing ChannelListing, which
-- by definition does not exist for a listing we have not created yet, so a first offer could never
-- carry a price. It belongs on the plan rather than the product because it is a per-marketplace
-- decision — a different currency, a different set of competitors, a different fee structure.
ALTER TABLE "product_channel_plan"
  ADD COLUMN "offer_price_cents" INTEGER;
