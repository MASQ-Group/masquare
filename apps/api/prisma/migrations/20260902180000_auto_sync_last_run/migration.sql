-- Record what the daily auto-sync did.
--
-- A run that finds nothing eligible logs "0 connection(s)" to the server and exits, which from the
-- outside is identical to a run that never happened. Storing the outcome lets the Integrations
-- page answer "did it run?" without anyone reading production logs.

ALTER TABLE "platform_settings" ADD COLUMN "last_auto_sync_at" TIMESTAMP(3);
ALTER TABLE "platform_settings" ADD COLUMN "last_auto_sync_eligible" INTEGER;
ALTER TABLE "platform_settings" ADD COLUMN "last_auto_sync_failed" INTEGER;
