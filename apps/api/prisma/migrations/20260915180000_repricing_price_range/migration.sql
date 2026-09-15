-- Per-SKU minimum price and time-boxed clearance for the Amazon repricer. All start empty:
-- every SKU keeps its margin floor until a person sets one of these.
ALTER TABLE "repricing_sku_pricing"
  ADD COLUMN "min_price_cents" INTEGER,
  ADD COLUMN "clearance_floor_cents" INTEGER,
  ADD COLUMN "clearance_reason" TEXT,
  ADD COLUMN "clearance_ends_at" TIMESTAMP(3),
  ADD COLUMN "clearance_until_stock" INTEGER,
  ADD COLUMN "clearance_set_at" TIMESTAMP(3),
  ADD COLUMN "clearance_set_by" UUID;
