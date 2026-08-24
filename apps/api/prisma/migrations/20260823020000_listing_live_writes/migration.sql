-- Whether creating real marketplace listings is permitted.
--
-- Off by default, and it stays a second gate rather than the only one: every submission is also
-- admin-only and separately confirmed, and the LISTING_LIVE_WRITES environment variable can force
-- it off regardless of what this says. Same shape as the repricing kill switch — a control you can
-- reach without a deploy, and an environment override that overrules it.
ALTER TABLE "platform_settings"
  ADD COLUMN "listing_live_writes" BOOLEAN NOT NULL DEFAULT false;
