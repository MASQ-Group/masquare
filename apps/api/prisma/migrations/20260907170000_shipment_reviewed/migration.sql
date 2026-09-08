-- Accounting's check of a recorded shipping cost against the carrier's invoice.
--
-- A date rather than a boolean, so the record says when as well as whether, and the person beside
-- it because "reviewed" is an assurance. Null means not yet checked, which is the state every
-- existing shipment is correctly in.
--
-- Additive and nullable: nothing existing changes meaning.
ALTER TABLE "shipment"
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by" UUID;

-- The filter is "reviewed" vs "not reviewed" over the whole table, so the partial index covers the
-- selective half; the unreviewed majority is a sequential scan either way.
CREATE INDEX "shipment_reviewed_at_idx" ON "shipment"("reviewed_at") WHERE "reviewed_at" IS NOT NULL;
