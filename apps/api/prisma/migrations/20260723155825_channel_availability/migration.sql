-- CreateTable
CREATE TABLE "product_availability" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "last_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "product_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_ledger" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "new_quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "availability_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_listing" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "channel_sku" TEXT NOT NULL,
    "product_id" UUID,
    "asin" TEXT,
    "title" TEXT,
    "listed_quantity" INTEGER,
    "listed_price" DOUBLE PRECISION,
    "currency" TEXT,
    "fulfilment_channel" TEXT,
    "listing_status" TEXT,
    "last_pulled_at" TIMESTAMP(3),
    "last_pushed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_availability_product_id_key" ON "product_availability"("product_id");

-- CreateIndex
CREATE INDEX "availability_ledger_product_id_idx" ON "availability_ledger"("product_id");

-- CreateIndex
CREATE INDEX "channel_listing_product_id_idx" ON "channel_listing"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_listing_integration_id_channel_sku_key" ON "channel_listing"("integration_id", "channel_sku");

-- AddForeignKey
ALTER TABLE "product_availability" ADD CONSTRAINT "product_availability_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_ledger" ADD CONSTRAINT "availability_ledger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_listing" ADD CONSTRAINT "channel_listing_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_listing" ADD CONSTRAINT "channel_listing_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "channel_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
