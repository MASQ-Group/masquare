-- AlterTable
ALTER TABLE "sales_transaction" ADD COLUMN     "fee_refunded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refund_amount" DOUBLE PRECISION,
ADD COLUMN     "resolution" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "resolution_notes" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "restock_items" BOOLEAN NOT NULL DEFAULT false;
