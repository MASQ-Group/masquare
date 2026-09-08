-- What the competition looked like, stored beside what the catalogue said.
--
-- Additive and nullable throughout: every existing row means "never priced", which is exactly what
-- NULL says here. A default of false would have claimed we know these marketplaces are uncompetitive.
ALTER TABLE "product_channel_availability"
  ADD COLUMN IF NOT EXISTS "competitive" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "competition_checked_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "featured_price_cents" INTEGER,
  ADD COLUMN IF NOT EXISTS "featured_margin_pct" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "currency" TEXT;
