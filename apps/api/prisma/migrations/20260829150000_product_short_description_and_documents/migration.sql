-- One or two sentences for a buyer deciding in seconds, above the full description on the B2B store.
ALTER TABLE "product" ADD COLUMN "short_description" TEXT;

-- Documents a buyer may need before ordering: datasheet, certificate, manual.
-- PDF only, at most three per product, named by the person uploading them.
-- Never public — served to a signed-in customer entitled to the product.
CREATE TABLE "product_document" (
  "id"         UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "name"       TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "size_bytes" INTEGER,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" UUID,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "product_document_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_document_product_id_idx" ON "product_document"("product_id");
ALTER TABLE "product_document"
  ADD CONSTRAINT "product_document_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
