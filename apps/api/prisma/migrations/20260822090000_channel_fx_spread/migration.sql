-- Replace the absolute per-channel rate with a percentage spread below the market rate.
--
-- A fixed rate is only correct on the day it was read: the market moves daily while the
-- marketplace's markup does not. eBay's spread measured 3.02% on USD, 3.02-3.03% on GBP and
-- 3.02% on AUD over a month, so the markup is the stable quantity and the rate is not.
--
-- The absolute columns shipped the same day and were never populated, so nothing is carried over;
-- an absolute rate could not be converted to a spread anyway without knowing the market rate on
-- the day it was read.
ALTER TABLE "sales_channel"
  ADD COLUMN "fx_spread_pct" DOUBLE PRECISION,
  ADD COLUMN "fx_spread_note" TEXT,
  ADD COLUMN "fx_spread_set_at" TIMESTAMP(3);

ALTER TABLE "sales_channel"
  DROP COLUMN IF EXISTS "fx_rate_override",
  DROP COLUMN IF EXISTS "fx_rate_override_note",
  DROP COLUMN IF EXISTS "fx_rate_override_set_at";
