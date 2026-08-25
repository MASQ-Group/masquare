-- When a cancelled order was cancelled: 'pending' (never became an order) or 'placed'
-- (confirmed, then cancelled before dispatch). Null on existing rows — the display falls
-- back to the old undifferentiated "Cxl" until a re-sync fills it from Amazon.
ALTER TABLE "sales_transaction" ADD COLUMN "cancel_stage" TEXT;

-- Only cancelled rows can carry a stage, and only these two values are meaningful.
ALTER TABLE "sales_transaction"
  ADD CONSTRAINT "sales_transaction_cancel_stage_check"
  CHECK ("cancel_stage" IS NULL OR ("resolution" = 'cancelled' AND "cancel_stage" IN ('pending', 'placed')));
