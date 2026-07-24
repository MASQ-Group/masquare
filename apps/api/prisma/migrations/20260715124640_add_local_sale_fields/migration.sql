-- AlterTable
ALTER TABLE "sales_transaction" ADD COLUMN     "delivery_method" TEXT,
ADD COLUMN     "local_shipping_cost_eur" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "sales_transaction_item" ADD COLUMN     "vat_class_id" UUID,
ADD COLUMN     "vat_rate_pct" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "sales_transaction_item" ADD CONSTRAINT "sales_transaction_item_vat_class_id_fkey" FOREIGN KEY ("vat_class_id") REFERENCES "vat_class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
