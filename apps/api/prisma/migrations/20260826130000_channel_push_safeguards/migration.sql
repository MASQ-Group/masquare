-- Outbound channel writes, controllable without disconnecting an integration (which would also
-- stop order sync). Defaulted ON so enabling the feature changes no behaviour by itself.
ALTER TABLE "platform_settings"
  ADD COLUMN "channel_quantity_push_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "channel_price_push_enabled"    BOOLEAN NOT NULL DEFAULT true;

-- How many listings one run may take from a real quantity to zero before it refuses outright.
-- A push that empties a catalogue is never routine, whatever the cause.
ALTER TABLE "platform_settings"
  ADD COLUMN "max_zeroing_pushes_per_run" INTEGER NOT NULL DEFAULT 25;
