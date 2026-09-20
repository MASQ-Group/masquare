-- Jinius orders are kept as ORDERS, never as sales transactions: accounting invoices these sales
-- locally and that local transaction is what the reports count. Additive throughout.
ALTER TABLE "sales_transaction" ADD COLUMN "availability_handled_elsewhere" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "jinius_order" (
  "id" UUID NOT NULL,
  "integration_id" UUID NOT NULL,
  "company_id" UUID,
  "order_id" TEXT NOT NULL,
  "commercial_id" TEXT,
  "ordered_at" TIMESTAMP(3) NOT NULL,
  "state" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "tax_mode" TEXT,
  "price_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "shipping_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "linked_transaction_id" UUID,
  "linked_at" TIMESTAMP(3),
  "linked_by" UUID,
  "availability_deducted_at" TIMESTAMP(3),
  "raw" JSONB,
  "last_pulled_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "jinius_order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "jinius_order_integration_id_order_id_key" ON "jinius_order"("integration_id", "order_id");
CREATE INDEX "jinius_order_linked_transaction_id_idx" ON "jinius_order"("linked_transaction_id");
CREATE INDEX "jinius_order_ordered_at_idx" ON "jinius_order"("ordered_at");
CREATE INDEX "jinius_order_deleted_at_idx" ON "jinius_order"("deleted_at");

CREATE TABLE "jinius_order_line" (
  "id" UUID NOT NULL,
  "jinius_order_id" UUID NOT NULL,
  "order_line_id" TEXT NOT NULL,
  "offer_sku" TEXT NOT NULL,
  "product_title" TEXT,
  "product_id" UUID,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unit_price" DOUBLE PRECISION,
  "shipping_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tax_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "state" TEXT,
  "availability_deducted_qty" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "jinius_order_line_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "jinius_order_line_jinius_order_id_order_line_id_key" ON "jinius_order_line"("jinius_order_id", "order_line_id");
CREATE INDEX "jinius_order_line_product_id_idx" ON "jinius_order_line"("product_id");

ALTER TABLE "jinius_order" ADD CONSTRAINT "jinius_order_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "channel_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jinius_order" ADD CONSTRAINT "jinius_order_linked_transaction_id_fkey" FOREIGN KEY ("linked_transaction_id") REFERENCES "sales_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "jinius_order_line" ADD CONSTRAINT "jinius_order_line_jinius_order_id_fkey" FOREIGN KEY ("jinius_order_id") REFERENCES "jinius_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jinius_order_line" ADD CONSTRAINT "jinius_order_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
