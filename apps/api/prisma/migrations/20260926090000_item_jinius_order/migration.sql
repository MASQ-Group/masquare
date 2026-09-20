-- A local invoice line filled in from a Jinius sale names that sale, so the invoice can be read back
-- to the marketplace orders it covers. No foreign key: the line keeps the reference even if the
-- order row is ever cleared, and the reference is only ever written by the platform itself.
ALTER TABLE "sales_transaction_item" ADD COLUMN "jinius_order_id" UUID;
CREATE INDEX "sales_transaction_item_jinius_order_id_idx" ON "sales_transaction_item"("jinius_order_id");
