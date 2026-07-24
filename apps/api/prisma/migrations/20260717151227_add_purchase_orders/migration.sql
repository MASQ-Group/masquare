-- CreateTable
CREATE TABLE "purchase_order" (
    "id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "expected_delivery_date" TIMESTAMP(3),
    "destination_warehouse_id" UUID,
    "notes" TEXT,
    "submitted_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_line" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_ordered" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_status_event" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "purchase_order_status_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_po_number_key" ON "purchase_order"("po_number");

-- CreateIndex
CREATE INDEX "purchase_order_vendor_id_idx" ON "purchase_order"("vendor_id");

-- CreateIndex
CREATE INDEX "purchase_order_company_id_idx" ON "purchase_order"("company_id");

-- CreateIndex
CREATE INDEX "purchase_order_status_idx" ON "purchase_order"("status");

-- CreateIndex
CREATE INDEX "purchase_order_line_purchase_order_id_idx" ON "purchase_order_line"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_line_product_id_idx" ON "purchase_order_line"("product_id");

-- CreateIndex
CREATE INDEX "purchase_order_status_event_purchase_order_id_idx" ON "purchase_order_status_event"("purchase_order_id");

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_destination_warehouse_id_fkey" FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_status_event" ADD CONSTRAINT "purchase_order_status_event_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
