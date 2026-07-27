-- CreateIndex
CREATE INDEX "product_deleted_at_idx" ON "product"("deleted_at");

-- CreateIndex
CREATE INDEX "product_brand_id_idx" ON "product"("brand_id");

-- CreateIndex
CREATE INDEX "product_vendor_id_idx" ON "product"("vendor_id");

-- CreateIndex
CREATE INDEX "product_category_id_idx" ON "product"("category_id");

-- CreateIndex
CREATE INDEX "product_product_type_id_idx" ON "product"("product_type_id");

-- CreateIndex
CREATE INDEX "product_fulfilment_type_id_idx" ON "product"("fulfilment_type_id");

-- CreateIndex
CREATE INDEX "sales_transaction_company_id_date_idx" ON "sales_transaction"("company_id", "date");

-- CreateIndex
CREATE INDEX "sales_transaction_deleted_at_idx" ON "sales_transaction"("deleted_at");

-- CreateIndex
CREATE INDEX "sales_transaction_integration_id_transaction_ref_idx" ON "sales_transaction"("integration_id", "transaction_ref");

-- CreateIndex
CREATE INDEX "sales_transaction_sales_channel_id_idx" ON "sales_transaction"("sales_channel_id");

-- CreateIndex
CREATE INDEX "sales_transaction_destination_country_id_idx" ON "sales_transaction"("destination_country_id");

-- CreateIndex
CREATE INDEX "sales_transaction_item_transaction_id_idx" ON "sales_transaction_item"("transaction_id");

-- CreateIndex
CREATE INDEX "sales_transaction_item_product_id_idx" ON "sales_transaction_item"("product_id");

-- CreateIndex
CREATE INDEX "sales_transaction_item_sku_idx" ON "sales_transaction_item"("sku");
