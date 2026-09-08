-- The retention tombstone.
--
-- The row outlives the purge on purpose: "erased after twelve months" and "no address was ever
-- held" are different facts, and this column is also what stops a later channel sync from
-- re-importing an address we have just erased.
ALTER TABLE "sales_transaction_address"
  ADD COLUMN IF NOT EXISTS "purged_at" TIMESTAMP(3);

-- The purge sweep's own query: unpurged rows, oldest first.
CREATE INDEX IF NOT EXISTS "sales_transaction_address_purged_at_idx"
  ON "sales_transaction_address"("purged_at");
