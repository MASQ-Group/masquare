-- AlterTable
ALTER TABLE "product" ADD COLUMN     "product_class_id" UUID;

-- AlterTable
ALTER TABLE "sales_transaction_item" ADD COLUMN     "unit_net_cost_eur" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "product_class" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_class_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_product_class_id_fkey" FOREIGN KEY ("product_class_id") REFERENCES "product_class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
