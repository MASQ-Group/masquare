-- AlterTable
ALTER TABLE "fba_shipment" ADD COLUMN     "empty_boxes_weight_kg" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "fba_shipment_item" ADD COLUMN     "box_id" UUID;

-- AlterTable
ALTER TABLE "shipping_service" ADD COLUMN     "tracking_url_template" TEXT;

-- CreateTable
CREATE TABLE "fba_shipment_box" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "label" TEXT,
    "empty_weight_kg" DECIMAL(12,3),
    "length_cm" DECIMAL(10,2),
    "width_cm" DECIMAL(10,2),
    "height_cm" DECIMAL(10,2),
    "tracking_number" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fba_shipment_box_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fba_shipment_box_shipment_id_idx" ON "fba_shipment_box"("shipment_id");

-- CreateIndex
CREATE INDEX "fba_shipment_item_box_id_idx" ON "fba_shipment_item"("box_id");

-- AddForeignKey
ALTER TABLE "fba_shipment_box" ADD CONSTRAINT "fba_shipment_box_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "fba_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fba_shipment_item" ADD CONSTRAINT "fba_shipment_item_box_id_fkey" FOREIGN KEY ("box_id") REFERENCES "fba_shipment_box"("id") ON DELETE CASCADE ON UPDATE CASCADE;
