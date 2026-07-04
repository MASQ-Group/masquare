-- AlterTable
ALTER TABLE "sales_channel" ADD COLUMN     "vat_above_threshold_pct" DOUBLE PRECISION,
ADD COLUMN     "vat_below_threshold_pct" DOUBLE PRECISION,
ADD COLUMN     "vat_threshold_amount" DOUBLE PRECISION,
ADD COLUMN     "vat_threshold_currency" TEXT,
ADD COLUMN     "vat_threshold_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sales_transaction" ADD COLUMN     "vat_overridden" BOOLEAN NOT NULL DEFAULT false;
