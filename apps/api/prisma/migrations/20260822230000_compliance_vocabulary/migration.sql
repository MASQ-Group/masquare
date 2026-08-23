-- Controlled vocabularies for the facts a marketplace judges a product on, and the removal of the
-- Shopify-only content fields (Shopify becomes its own module rather than a channel here).

CREATE TABLE "compliance_option" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"        TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  -- Only VOLTAGE_RATING populates these: the eligibility rules compare numbers, so the range has
  -- to travel with the option rather than be parsed back out of its label.
  "numeric_min" INTEGER,
  "numeric_max" INTEGER,
  "note"        TEXT,
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3)
);

CREATE UNIQUE INDEX "compliance_option_kind_code_key" ON "compliance_option" ("kind", "code");
CREATE INDEX "compliance_option_kind_active_idx" ON "compliance_option" ("kind", "active");

-- Product: free text out, references in.
ALTER TABLE "product"
  DROP COLUMN "voltage_min_v",
  DROP COLUMN "voltage_max_v",
  DROP COLUMN "frequency_hz",
  DROP COLUMN "plug_type",
  DROP COLUMN "battery_type",
  DROP COLUMN "hazmat_class",
  DROP COLUMN "seo_title",
  DROP COLUMN "seo_description",
  DROP COLUMN "url_handle",
  ADD COLUMN "voltage_rating_id" UUID,
  ADD COLUMN "frequency_id"      UUID,
  ADD COLUMN "plug_type_id"      UUID,
  ADD COLUMN "battery_type_id"   UUID,
  ADD COLUMN "hazmat_class_id"   UUID;

-- SET NULL rather than RESTRICT: retiring a vocabulary entry should not be blocked by products
-- that still reference it, and a null reads correctly as "not stated".
ALTER TABLE "product"
  ADD CONSTRAINT "product_voltage_rating_id_fkey" FOREIGN KEY ("voltage_rating_id") REFERENCES "compliance_option"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "product_frequency_id_fkey"      FOREIGN KEY ("frequency_id")      REFERENCES "compliance_option"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "product_plug_type_id_fkey"      FOREIGN KEY ("plug_type_id")      REFERENCES "compliance_option"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "product_battery_type_id_fkey"   FOREIGN KEY ("battery_type_id")   REFERENCES "compliance_option"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "product_hazmat_class_id_fkey"   FOREIGN KEY ("hazmat_class_id")   REFERENCES "compliance_option"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Shopify is not a channel this module lists to.
DELETE FROM "marketplace_profile" WHERE "channel_type" = 'shopify';
