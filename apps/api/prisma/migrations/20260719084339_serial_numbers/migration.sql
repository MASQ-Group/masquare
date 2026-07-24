-- AlterTable
ALTER TABLE "product" ADD COLUMN     "serial_tracked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "serial_number" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "warehouse_id" UUID,
    "goods_receipt_id" UUID,
    "received_at" TIMESTAMP(3),
    "sales_transaction_id" UUID,
    "vendor_return_id" UUID,
    "dispatched_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "serial_number_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "serial_number_product_id_status_idx" ON "serial_number"("product_id", "status");

-- CreateIndex
CREATE INDEX "serial_number_warehouse_id_idx" ON "serial_number"("warehouse_id");

-- CreateIndex
CREATE INDEX "serial_number_sales_transaction_id_idx" ON "serial_number"("sales_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "serial_number_product_id_serial_key" ON "serial_number"("product_id", "serial");

-- AddForeignKey
ALTER TABLE "serial_number" ADD CONSTRAINT "serial_number_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_number" ADD CONSTRAINT "serial_number_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
