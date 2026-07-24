-- AlterTable
ALTER TABLE "sales_transaction" ADD COLUMN     "resolution_source" TEXT,
ADD COLUMN     "return_handled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "return_warehouse_id" UUID;
