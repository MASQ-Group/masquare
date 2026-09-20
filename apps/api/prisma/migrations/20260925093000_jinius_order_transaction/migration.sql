-- A Jinius order is reported as a sales transaction of its own, like every other channel's orders.
ALTER TABLE "jinius_order" ADD COLUMN "sales_transaction_id" UUID;
CREATE INDEX "jinius_order_sales_transaction_id_idx" ON "jinius_order"("sales_transaction_id");
ALTER TABLE "jinius_order" ADD CONSTRAINT "jinius_order_sales_transaction_id_fkey"
  FOREIGN KEY ("sales_transaction_id") REFERENCES "sales_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
