-- CreateTable
CREATE TABLE "goods_receipt" (
    "id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "is_backorder" BOOLEAN NOT NULL DEFAULT false,
    "parent_receipt_id" UUID,
    "destination_warehouse_id" UUID,
    "notes" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "goods_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_line" (
    "id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "quantity_expected" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_receipt_number_key" ON "goods_receipt"("receipt_number");

-- CreateIndex
CREATE INDEX "goods_receipt_purchase_order_id_idx" ON "goods_receipt"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipt_status_idx" ON "goods_receipt"("status");

-- CreateIndex
CREATE INDEX "goods_receipt_line_goods_receipt_id_idx" ON "goods_receipt_line"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "goods_receipt_line_purchase_order_line_id_idx" ON "goods_receipt_line"("purchase_order_line_id");

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_destination_warehouse_id_fkey" FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_parent_receipt_id_fkey" FOREIGN KEY ("parent_receipt_id") REFERENCES "goods_receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
