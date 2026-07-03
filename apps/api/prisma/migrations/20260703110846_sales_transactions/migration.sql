-- AlterTable
ALTER TABLE "sales_channel" ADD COLUMN     "fee_charged_in_native_currency" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "fee_currency" TEXT;

-- CreateTable
CREATE TABLE "sales_transaction" (
    "id" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "transaction_ref" TEXT NOT NULL,
    "sales_channel_id" UUID,
    "destination_country_id" UUID,
    "company_id" UUID,
    "currency" TEXT,
    "fee_currency" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sales_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_transaction_item" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "product_id" UUID,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "net_sales_amount" DOUBLE PRECISION,
    "vat_amount" DOUBLE PRECISION,
    "shipping_amount" DOUBLE PRECISION,
    "shipping_amount_vat" DOUBLE PRECISION,
    "sales_channel_sales_fee_amount" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sales_transaction_item_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sales_transaction" ADD CONSTRAINT "sales_transaction_sales_channel_id_fkey" FOREIGN KEY ("sales_channel_id") REFERENCES "sales_channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transaction" ADD CONSTRAINT "sales_transaction_destination_country_id_fkey" FOREIGN KEY ("destination_country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transaction" ADD CONSTRAINT "sales_transaction_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transaction_item" ADD CONSTRAINT "sales_transaction_item_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "sales_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transaction_item" ADD CONSTRAINT "sales_transaction_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
