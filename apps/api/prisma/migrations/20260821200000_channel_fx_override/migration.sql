-- Per-channel exchange rate, for marketplaces that convert at their own rate and pay out in EUR.
-- Null keeps the platform market rate.
ALTER TABLE "sales_channel"
  ADD COLUMN "fx_rate_override" DOUBLE PRECISION,
  ADD COLUMN "fx_rate_override_note" TEXT,
  ADD COLUMN "fx_rate_override_set_at" TIMESTAMP(3);
