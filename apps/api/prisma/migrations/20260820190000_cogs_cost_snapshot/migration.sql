-- COGS frozen at the time a sale was created or pulled, so a later purchase-cost change applies
-- forward only and never restates profit already reported.
ALTER TABLE "sales_transaction_item"
  ADD COLUMN "unit_cost_snapshot_eur" DECIMAL(14,4),
  ADD COLUMN "cost_snapshot_source" TEXT,
  ADD COLUMN "cost_snapshot_at" TIMESTAMP(3);

-- Freeze every existing line at the cost it resolves to TODAY. Not perfectly accurate for old
-- sales -- the cost at the time was not recorded -- but it is the only data that exists, and it
-- stops the first vendor price upload rewriting years of reported profit.
--
-- Mirrors the read-time preference order exactly, so no reported figure moves as a result of
-- this migration: the moving average when it is non-zero, else the catalogue purchase cost.
-- Lines carrying an explicit override are left alone; the override outranks the snapshot anyway.
UPDATE "sales_transaction_item" i
   SET "unit_cost_snapshot_eur" = COALESCE(NULLIF(p."average_cost_eur", 0), p."purchase_cost_amount"),
       "cost_snapshot_source"   = CASE WHEN COALESCE(p."average_cost_eur", 0) > 0 THEN 'average' ELSE 'catalogue' END,
       "cost_snapshot_at"       = now()
  FROM "product" p
 WHERE i."product_id" = p."id"
   AND i."deleted_at" IS NULL
   AND COALESCE(NULLIF(p."average_cost_eur", 0), p."purchase_cost_amount") IS NOT NULL;
