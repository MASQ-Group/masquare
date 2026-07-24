-- AlterTable
ALTER TABLE "goods_receipt" ADD COLUMN     "customs_duty" DECIMAL(14,2),
ADD COLUMN     "customs_duty_allocation" TEXT NOT NULL DEFAULT 'value',
ADD COLUMN     "customs_duty_currency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "fx_rate_used" DECIMAL(18,8),
ADD COLUMN     "import_handling" DECIMAL(14,2),
ADD COLUMN     "import_handling_allocation" TEXT NOT NULL DEFAULT 'value',
ADD COLUMN     "import_handling_currency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "import_vat" DECIMAL(14,2),
ADD COLUMN     "import_vat_currency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "shipping_allocation" TEXT NOT NULL DEFAULT 'weight',
ADD COLUMN     "shipping_cost" DECIMAL(14,2),
ADD COLUMN     "shipping_currency" TEXT NOT NULL DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "purchase_order" ADD COLUMN     "amount_paid_eur" DECIMAL(14,2),
ADD COLUMN     "customs_duty" DECIMAL(14,2),
ADD COLUMN     "customs_duty_allocation" TEXT NOT NULL DEFAULT 'value',
ADD COLUMN     "customs_duty_currency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "fx_rate" DECIMAL(18,8),
ADD COLUMN     "import_handling" DECIMAL(14,2),
ADD COLUMN     "import_handling_allocation" TEXT NOT NULL DEFAULT 'value',
ADD COLUMN     "import_handling_currency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "import_vat" DECIMAL(14,2),
ADD COLUMN     "import_vat_currency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "shipping_allocation" TEXT NOT NULL DEFAULT 'weight',
ADD COLUMN     "shipping_cost" DECIMAL(14,2),
ADD COLUMN     "shipping_currency" TEXT NOT NULL DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "vendor" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'EUR';
