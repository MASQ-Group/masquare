-- CreateTable
CREATE TABLE "vendor_return" (
    "id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "vendor_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "reason" TEXT NOT NULL,
    "credit_note_ref" TEXT,
    "notes" TEXT,
    "total_quantity" INTEGER NOT NULL DEFAULT 0,
    "total_cost_eur" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vendor_return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_return_line" (
    "id" UUID NOT NULL,
    "vendor_return_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "purchase_order_line_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_cost_eur" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_return_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_return_return_number_key" ON "vendor_return"("return_number");

-- CreateIndex
CREATE INDEX "vendor_return_vendor_id_idx" ON "vendor_return"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_return_purchase_order_id_idx" ON "vendor_return"("purchase_order_id");

-- CreateIndex
CREATE INDEX "vendor_return_status_idx" ON "vendor_return"("status");

-- CreateIndex
CREATE INDEX "vendor_return_line_vendor_return_id_idx" ON "vendor_return_line"("vendor_return_id");

-- CreateIndex
CREATE INDEX "vendor_return_line_product_id_idx" ON "vendor_return_line"("product_id");

-- AddForeignKey
ALTER TABLE "vendor_return" ADD CONSTRAINT "vendor_return_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_return" ADD CONSTRAINT "vendor_return_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_return" ADD CONSTRAINT "vendor_return_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_return_line" ADD CONSTRAINT "vendor_return_line_vendor_return_id_fkey" FOREIGN KEY ("vendor_return_id") REFERENCES "vendor_return"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_return_line" ADD CONSTRAINT "vendor_return_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_return_line" ADD CONSTRAINT "vendor_return_line_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;
