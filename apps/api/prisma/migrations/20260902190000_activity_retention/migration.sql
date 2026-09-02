-- How long the activity log is kept, split by who caused the entry.
--
-- One number cannot serve both halves: the volume comes from machines (a nightly sync touches
-- thousands of orders) while the value comes from people (a handful of entries a day). On one
-- clock you must choose between unbounded growth and discarding the human record. On two, the
-- noisy half can be cut hard while a year of people's actions costs almost nothing.

ALTER TABLE "platform_settings" ADD COLUMN "activity_retention_user_days" INTEGER NOT NULL DEFAULT 365;
ALTER TABLE "platform_settings" ADD COLUMN "activity_retention_system_days" INTEGER NOT NULL DEFAULT 30;

-- The purge deletes by (source, created_at); without this it is a sequential scan of the whole
-- table every night, which gets slower exactly as the table gets bigger.
CREATE INDEX "activity_source_created_at_idx" ON "activity"("source", "created_at");
