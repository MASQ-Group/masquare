-- AlterTable
ALTER TABLE "sales_transaction" ADD COLUMN     "exchange_rate" DOUBLE PRECISION,
ADD COLUMN     "shipping_service_id" UUID;

-- AddForeignKey
ALTER TABLE "sales_transaction" ADD CONSTRAINT "sales_transaction_shipping_service_id_fkey" FOREIGN KEY ("shipping_service_id") REFERENCES "shipping_service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
