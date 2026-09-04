-- Retention for the repricer's working data.
--
-- Its four tables were 67% of the database and growing ~9 MB a day, all of it produced in shadow
-- mode by a module whose output nobody reads after the fact. Decisions and their offer snapshots
-- are the audit trail and worth months; fee estimates are mostly the verbatim Amazon response and
-- worth weeks — except the newest per SKU and marketplace, which the floor reads as live state and
-- the purge therefore keeps regardless of age.

ALTER TABLE "platform_settings" ADD COLUMN "repricing_decision_retention_days" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "platform_settings" ADD COLUMN "repricing_fee_retention_days" INTEGER NOT NULL DEFAULT 30;

-- The purges delete by age. Without these they are sequential scans that get slower exactly as the
-- tables they exist to bound get bigger.
CREATE INDEX IF NOT EXISTS "repricing_decision_at_idx" ON "repricing_decision"("at");
CREATE INDEX IF NOT EXISTS "repricing_offer_snapshot_created_at_idx" ON "repricing_offer_snapshot"("created_at");
