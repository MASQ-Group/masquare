-- Taxonomy import: stable handles for product types and categories, plus a navigation flag.
--
-- `path` on a category is the taxonomy's identity (full kebab-case path from the root). Names get
-- edited and rows get moved; matching a re-import on name + parent would then create duplicates.
-- `show_in_navigation` hides the Services & Fees branch (shipping charges, repairs, internal
-- placeholder SKUs) from the customer-facing menu without deleting real products.

ALTER TABLE "product_type" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "product_type_slug_key" ON "product_type"("slug");

ALTER TABLE "product_category" ADD COLUMN "slug" TEXT;
ALTER TABLE "product_category" ADD COLUMN "path" TEXT;
ALTER TABLE "product_category" ADD COLUMN "show_in_navigation" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "product_category_path_key" ON "product_category"("path");
