-- AlterTable
ALTER TABLE "sales_transaction_item" ADD COLUMN     "stock_deducted_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stock_warehouse_id" UUID;
