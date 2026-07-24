/*
  Warnings:

  - You are about to drop the column `vat_rate_pct` on the `purchase_order` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "purchase_order" DROP COLUMN "vat_rate_pct",
ADD COLUMN     "vat_treatment" TEXT NOT NULL DEFAULT 'standard';

-- AlterTable
ALTER TABLE "purchase_order_line" ADD COLUMN     "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vat_class_id" UUID,
ADD COLUMN     "vat_rate_pct" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "vendor" ADD COLUMN     "vat_number_checked_at" TIMESTAMP(3),
ADD COLUMN     "vat_number_checked_name" TEXT,
ADD COLUMN     "vat_number_valid" BOOLEAN,
ADD COLUMN     "vat_treatment" TEXT NOT NULL DEFAULT 'standard';

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_vat_class_id_fkey" FOREIGN KEY ("vat_class_id") REFERENCES "vat_class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
