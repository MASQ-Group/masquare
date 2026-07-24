-- AlterTable
ALTER TABLE "shipment" ADD COLUMN     "group_id" UUID;

-- CreateIndex
CREATE INDEX "shipment_group_id_idx" ON "shipment"("group_id");
