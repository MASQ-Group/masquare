-- AlterTable
ALTER TABLE "sales_transaction" ADD COLUMN     "fulfilment_status" TEXT NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "shipment" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'outbound',
    "shipment_date" TIMESTAMP(3) NOT NULL,
    "shipping_service_id" UUID,
    "tracking_number" TEXT,
    "shipping_cost_eur" DOUBLE PRECISION,
    "cost_borne_by" TEXT NOT NULL DEFAULT 'company',
    "duty_import_eur" DOUBLE PRECISION,
    "comments" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "shipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_transaction_id_idx" ON "shipment"("transaction_id");

-- AddForeignKey
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "sales_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_shipping_service_id_fkey" FOREIGN KEY ("shipping_service_id") REFERENCES "shipping_service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
