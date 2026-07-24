-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "deduct_stock_on_sale" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "stock_owed" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID,
    "sales_transaction_id" UUID NOT NULL,
    "transaction_ref" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "quantity_settled" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL DEFAULT 'sold_before_receipt',
    "due_by" TIMESTAMP(3),
    "notes" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by" UUID,
    "settled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "stock_owed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_owed_product_id_status_idx" ON "stock_owed"("product_id", "status");

-- CreateIndex
CREATE INDEX "stock_owed_sales_transaction_id_idx" ON "stock_owed"("sales_transaction_id");

-- CreateIndex
CREATE INDEX "stock_owed_status_opened_at_idx" ON "stock_owed"("status", "opened_at");

-- AddForeignKey
ALTER TABLE "stock_owed" ADD CONSTRAINT "stock_owed_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_owed" ADD CONSTRAINT "stock_owed_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_owed" ADD CONSTRAINT "stock_owed_sales_transaction_id_fkey" FOREIGN KEY ("sales_transaction_id") REFERENCES "sales_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
