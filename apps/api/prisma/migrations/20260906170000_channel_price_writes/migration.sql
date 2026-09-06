-- A separate switch for a person changing ONE listing's price.
--
-- It shares nothing with the other two write gates. The repricing engine writes prices in bulk from
-- automation (AMZ_REPRICING_LIVE_WRITES); creating a listing is a different act again
-- (listing_live_writes). Turning on a human editing a single price must not turn on either of the
-- others. Off by default; CHANNEL_PRICE_WRITES=false forces it off whatever the toggle says.
ALTER TABLE "platform_settings" ADD COLUMN "channel_price_writes" BOOLEAN NOT NULL DEFAULT false;
