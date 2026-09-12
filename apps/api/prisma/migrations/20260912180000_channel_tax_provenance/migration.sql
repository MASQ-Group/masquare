-- Why an order carries no tax figure is not answerable from anything we store.
--
-- Roughly a tenth of Amazon orders to a rated destination arrive with no tax of any kind — steadily,
-- 6% to 20% every month for a year, across every EU marketplace and both fulfilment types. The
-- mapping reads `IsBusinessOrder` and the per-item tax block and keeps neither, so the distinction
-- between "reported as zero" and "never reported" is lost before anything could look at it.
--
-- Both columns are nullable and additive: existing rows keep NULL, meaning "nobody asked", which is
-- the honest answer for an order imported before the question existed.
ALTER TABLE "sales_transaction" ADD COLUMN IF NOT EXISTS "is_business_order" BOOLEAN;
ALTER TABLE "sales_transaction_item" ADD COLUMN IF NOT EXISTS "channel_tax_raw" JSONB;
