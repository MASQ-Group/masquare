-- CreateTable
CREATE TABLE "fba_shipment" (
    "id" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sales_channel_id" UUID,
    "destination_country_id" UUID,
    "fba_shipment_ref" TEXT,
    "shipping_service_id" UUID,
    "shipping_zone_id" UUID,
    "calc_method" TEXT,
    "packaging_pct" DECIMAL(6,2) NOT NULL DEFAULT 10,
    "basis_weight_kg" DECIMAL(12,3),
    "chargeable_weight_kg" DECIMAL(12,3),
    "estimated_cost_eur" DECIMAL(12,2),
    "actual_cost_eur" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "comments" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fba_shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fba_shipment_item" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "product_id" UUID,
    "sku" TEXT NOT NULL,
    "title" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_weight_kg" DECIMAL(12,3),
    "allocated_cost_eur" DECIMAL(12,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fba_shipment_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fba_shipment_sales_channel_id_idx" ON "fba_shipment"("sales_channel_id");

-- CreateIndex
CREATE INDEX "fba_shipment_item_shipment_id_idx" ON "fba_shipment_item"("shipment_id");

-- CreateIndex
CREATE INDEX "fba_shipment_item_product_id_idx" ON "fba_shipment_item"("product_id");

-- AddForeignKey
ALTER TABLE "fba_shipment" ADD CONSTRAINT "fba_shipment_sales_channel_id_fkey" FOREIGN KEY ("sales_channel_id") REFERENCES "sales_channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fba_shipment" ADD CONSTRAINT "fba_shipment_destination_country_id_fkey" FOREIGN KEY ("destination_country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fba_shipment" ADD CONSTRAINT "fba_shipment_shipping_service_id_fkey" FOREIGN KEY ("shipping_service_id") REFERENCES "shipping_service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fba_shipment" ADD CONSTRAINT "fba_shipment_shipping_zone_id_fkey" FOREIGN KEY ("shipping_zone_id") REFERENCES "shipping_zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fba_shipment_item" ADD CONSTRAINT "fba_shipment_item_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "fba_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fba_shipment_item" ADD CONSTRAINT "fba_shipment_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
