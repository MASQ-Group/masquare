-- AlterTable
ALTER TABLE "channel_listing" ADD COLUMN     "company_id" UUID;

-- AlterTable
ALTER TABLE "fba_shipment" ADD COLUMN     "company_id" UUID;

-- AlterTable
ALTER TABLE "goods_receipt" ADD COLUMN     "company_id" UUID;

-- AlterTable
ALTER TABLE "vendor_return" ADD COLUMN     "company_id" UUID;

-- AlterTable
ALTER TABLE "warehouse" ADD COLUMN     "company_id" UUID;

-- CreateIndex
CREATE INDEX "channel_listing_company_id_idx" ON "channel_listing"("company_id");

-- CreateIndex
CREATE INDEX "fba_shipment_company_id_idx" ON "fba_shipment"("company_id");

-- CreateIndex
CREATE INDEX "goods_receipt_company_id_idx" ON "goods_receipt"("company_id");

-- CreateIndex
CREATE INDEX "vendor_return_company_id_idx" ON "vendor_return"("company_id");

-- CreateIndex
CREATE INDEX "warehouse_company_id_idx" ON "warehouse"("company_id");

-- AddForeignKey
ALTER TABLE "channel_listing" ADD CONSTRAINT "channel_listing_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_return" ADD CONSTRAINT "vendor_return_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fba_shipment" ADD CONSTRAINT "fba_shipment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
