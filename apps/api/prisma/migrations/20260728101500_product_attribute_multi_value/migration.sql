-- Allow a product to carry an attribute more than once (multi-value attributes):
-- uniqueness is now per distinct value rather than one row per (product, attribute).

-- DropIndex
DROP INDEX "product_attribute_product_id_attribute_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_product_id_attribute_id_value_key" ON "product_attribute"("product_id", "attribute_id", "value");
