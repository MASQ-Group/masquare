-- An explicit "this vendor's code means this product" decision, for rows a vendor file cannot
-- match on its own. Recorded once by a human, reused on every later upload.
CREATE TABLE "vendor_sku_alias" (
  "id"         UUID PRIMARY KEY,
  "vendor_id"  UUID NOT NULL REFERENCES "vendor"("id") ON DELETE CASCADE,
  "vendor_sku" TEXT NOT NULL,
  "product_id" UUID NOT NULL REFERENCES "product"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "created_by" UUID,
  "deleted_at" TIMESTAMP(3)
);

CREATE UNIQUE INDEX "vendor_sku_alias_vendor_id_vendor_sku_key" ON "vendor_sku_alias"("vendor_id", "vendor_sku");
CREATE INDEX "vendor_sku_alias_product_id_idx" ON "vendor_sku_alias"("product_id");
