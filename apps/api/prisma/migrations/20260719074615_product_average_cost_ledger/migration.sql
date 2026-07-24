-- AlterTable
ALTER TABLE "product" ADD COLUMN     "average_cost_eur" DECIMAL(14,4),
ADD COLUMN     "average_cost_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "average_cost_updated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "product_cost_event" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" UUID,
    "reference" TEXT,
    "qty_delta" INTEGER NOT NULL,
    "unit_cost_eur" DECIMAL(14,4) NOT NULL,
    "landed_add_on_eur" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "qty_before" INTEGER NOT NULL,
    "avg_before_eur" DECIMAL(14,4),
    "qty_after" INTEGER NOT NULL,
    "avg_after_eur" DECIMAL(14,4) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "product_cost_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_cost_event_product_id_created_at_idx" ON "product_cost_event"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "product_cost_event_ref_type_ref_id_idx" ON "product_cost_event"("ref_type", "ref_id");

-- AddForeignKey
ALTER TABLE "product_cost_event" ADD CONSTRAINT "product_cost_event_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
