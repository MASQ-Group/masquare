-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "main_sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand_id" UUID,
    "vendor_id" UUID,
    "product_type_id" UUID,
    "fulfilment_type_id" UUID,
    "category_id" UUID,
    "ean" TEXT,
    "upc" TEXT,
    "vendor_sku" TEXT,
    "manufacturer_sku" TEXT,
    "country_of_origin" TEXT,
    "hs_code" TEXT,
    "purchase_cost_amount" DECIMAL(14,4),
    "purchase_cost_currency" TEXT NOT NULL DEFAULT 'EUR',
    "map_amount" DECIMAL(14,4),
    "map_currency" TEXT NOT NULL DEFAULT 'EUR',
    "msrp_amount" DECIMAL(14,4),
    "msrp_currency" TEXT NOT NULL DEFAULT 'EUR',
    "product_weight_kg" DECIMAL(10,3),
    "package_weight_kg" DECIMAL(10,3),
    "package_length_cm" DECIMAL(10,2),
    "package_width_cm" DECIMAL(10,2),
    "package_height_cm" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_sku_alias" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku_value" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_sku_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_attribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_company" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_main_sku_key" ON "product"("main_sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_sku_alias_sku_value_key" ON "product_sku_alias"("sku_value");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_product_id_attribute_id_key" ON "product_attribute"("product_id", "attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_company_product_id_company_id_key" ON "product_company"("product_id", "company_id");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_fulfilment_type_id_fkey" FOREIGN KEY ("fulfilment_type_id") REFERENCES "fulfilment_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sku_alias" ADD CONSTRAINT "product_sku_alias_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute" ADD CONSTRAINT "product_attribute_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute" ADD CONSTRAINT "product_attribute_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_company" ADD CONSTRAINT "product_company_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_company" ADD CONSTRAINT "product_company_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
