-- Per-product overrides of eBay's account-wide listing choices. Null means "use the channel's
-- default", which is how every existing row starts and stays unless someone changes one product.
ALTER TABLE "product_channel_plan"
  ADD COLUMN "merchant_location_key" TEXT,
  ADD COLUMN "fulfillment_policy_id" TEXT,
  ADD COLUMN "payment_policy_id" TEXT,
  ADD COLUMN "return_policy_id" TEXT;
