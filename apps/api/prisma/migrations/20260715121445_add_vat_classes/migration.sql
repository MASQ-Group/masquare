-- AlterTable
ALTER TABLE "product" ADD COLUMN     "vat_class_id" UUID;

-- CreateTable
CREATE TABLE "vat_class" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_pct" DECIMAL(5,2) NOT NULL,
    "tax_treatment" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vat_class_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_vat_class_id_fkey" FOREIGN KEY ("vat_class_id") REFERENCES "vat_class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
