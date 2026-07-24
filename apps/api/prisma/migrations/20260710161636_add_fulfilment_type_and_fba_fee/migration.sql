-- AlterTable
ALTER TABLE "sales_transaction" ADD COLUMN     "fulfilment_type" TEXT;

-- AlterTable
ALTER TABLE "sales_transaction_item" ADD COLUMN     "fba_fulfilment_fee_amount" DOUBLE PRECISION;
