-- What a new listing starts at, as a percentage margin.
--
-- Deliberately separate from the repricing floor margin. Listing at the floor is right once the
-- repricer is live and can raise the price; while it is in shadow mode nothing would ever move the
-- price up, so a product launched at its floor would sit at the minimum indefinitely. Two settings
-- means the day repricing goes live this becomes one number to change, not a code change.
ALTER TABLE "platform_settings"
  ADD COLUMN "launch_margin_pct" DECIMAL(5,2) NOT NULL DEFAULT 20;
