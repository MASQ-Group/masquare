-- AlterTable
ALTER TABLE "product_sku_alias" ADD COLUMN     "fulfilment_type_id" UUID;

-- AddForeignKey
ALTER TABLE "product_sku_alias" ADD CONSTRAINT "product_sku_alias_fulfilment_type_id_fkey" FOREIGN KEY ("fulfilment_type_id") REFERENCES "fulfilment_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;
