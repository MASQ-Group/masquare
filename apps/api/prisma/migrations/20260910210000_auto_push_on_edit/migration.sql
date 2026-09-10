-- Whether editing an availability quantity by hand pushes it to the channels straight away.
-- Off by default: a half-finished count must not reach a live listing.
ALTER TABLE "platform_settings" ADD COLUMN "auto_push_availability_on_edit" BOOLEAN NOT NULL DEFAULT false;
