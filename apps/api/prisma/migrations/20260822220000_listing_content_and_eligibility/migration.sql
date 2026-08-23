-- Phase 1 of marketplace listing creation: the data a listing needs, and the facts that decide
-- whether a product may be listed at all.
--
-- Nothing here writes to a marketplace. It only gives the platform somewhere to put listing content,
-- compliance contacts, and the technical properties an eligibility check reads.

-- ---------------------------------------------------------------------------
-- Product: listing content
--
-- Only eBay and Shopify display any of this. Amazon and OnBuy attach our offer to their own
-- catalogue entry and show their own copy, so `title` stays a name for our own people.
-- ---------------------------------------------------------------------------
ALTER TABLE "product"
  ADD COLUMN "ebay_title"        TEXT,
  ADD COLUMN "description_html"  TEXT,
  ADD COLUMN "key_features"      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "search_keywords"   TEXT,
  ADD COLUMN "seo_title"         TEXT,
  ADD COLUMN "seo_description"   TEXT,
  ADD COLUMN "url_handle"        TEXT;

-- ---------------------------------------------------------------------------
-- Product: technical facts that drive eligibility
--
-- Typed rather than free-text attributes deliberately. A rule cannot reliably read "220-240V ~50Hz"
-- out of a text field, and the entire point of these columns is that a machine decides on them.
-- Every column is nullable: "not stated" must stay distinguishable from "stated as none".
-- ---------------------------------------------------------------------------
ALTER TABLE "product"
  ADD COLUMN "voltage_min_v"      INTEGER,
  ADD COLUMN "voltage_max_v"      INTEGER,
  ADD COLUMN "frequency_hz"       TEXT,
  ADD COLUMN "plug_type"          TEXT,
  ADD COLUMN "battery_required"   BOOLEAN,
  ADD COLUMN "battery_type"       TEXT,
  ADD COLUMN "hazmat_class"       TEXT,
  ADD COLUMN "warranty_text"      TEXT,
  ADD COLUMN "dangerous_goods_note" TEXT;

-- ---------------------------------------------------------------------------
-- Brand: GPSR contacts (EU 2023/988, in force 13 December 2024)
--
-- On the brand because they describe a company, not a product: Fissler's responsible person is the
-- same on every Fissler line. Retyping an address onto thousands of products is how it goes wrong.
-- Nothing blocks on these being empty — no channel demands them of us yet.
-- ---------------------------------------------------------------------------
ALTER TABLE "brand"
  ADD COLUMN "manufacturer_name"        TEXT,
  ADD COLUMN "manufacturer_address"     TEXT,
  ADD COLUMN "manufacturer_email"       TEXT,
  ADD COLUMN "manufacturer_phone"       TEXT,
  ADD COLUMN "manufacturer_contact_url" TEXT,
  ADD COLUMN "eu_rp_name"               TEXT,
  ADD COLUMN "eu_rp_address"            TEXT,
  ADD COLUMN "eu_rp_email"              TEXT,
  ADD COLUMN "eu_rp_phone"              TEXT,
  ADD COLUMN "eu_rp_contact_url"        TEXT;

-- ---------------------------------------------------------------------------
-- The OnBuy boost ceiling.
--
-- OnBuy defaults new offers to 20% — a fifth of revenue. We default to 0 and refuse anything above
-- this ceiling rather than warn, because a warning on a bulk action is read once and the commission
-- is paid every month afterwards. 0 until someone deliberately raises it.
-- ---------------------------------------------------------------------------
ALTER TABLE "platform_settings"
  ADD COLUMN "max_boost_pct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- What a marketplace's mains supply and plug standard actually are.
--
-- Reference data rather than rules in code: a 230V appliance must never reach a US listing however
-- complete its record is, and that verdict has to be changeable by someone editing a table.
--
-- `marketplace` holds the CHANNEL'S OWN id, not a normalised ISO code, because that is what
-- channel_integration.marketplace holds and what we join on. Amazon calls Britain 'UK'; eBay calls
-- it 'GB'. Both are seeded below, deliberately.
-- ---------------------------------------------------------------------------
CREATE TABLE "marketplace_profile" (
  "id"                  UUID PRIMARY KEY,
  "channel_type"        TEXT NOT NULL,
  "marketplace"         TEXT NOT NULL DEFAULT '',
  "label"               TEXT NOT NULL,
  "mains_voltage_min_v" INTEGER,
  "mains_voltage_max_v" INTEGER,
  "mains_frequency_hz"  TEXT,
  "plug_types"          TEXT[] NOT NULL DEFAULT '{}',
  "allow_batteries"     BOOLEAN NOT NULL DEFAULT true,
  "allow_hazmat"        BOOLEAN NOT NULL DEFAULT true,
  "active"              BOOLEAN NOT NULL DEFAULT true,
  "note"                TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "marketplace_profile_channel_marketplace_key"
  ON "marketplace_profile" ("channel_type", "marketplace");

-- ---------------------------------------------------------------------------
-- Our intention to list one product on one channel.
--
-- Created on demand, never seeded: four thousand products across twenty channels would be eighty
-- thousand empty rows. A row existing means someone has started preparing a listing.
--
-- Eligibility is deliberately NOT stored here. It is derived from the product and the marketplace
-- profile every time it is asked for, so correcting a voltage fixes every verdict at once instead
-- of leaving stale ones scattered across rows nobody thinks to revisit.
-- ---------------------------------------------------------------------------
CREATE TABLE "product_channel_plan" (
  "id"                  UUID PRIMARY KEY,
  "product_id"          UUID NOT NULL REFERENCES "product"("id") ON DELETE CASCADE,
  "integration_id"      UUID NOT NULL REFERENCES "channel_integration"("id") ON DELETE CASCADE,
  "marketplace"         TEXT NOT NULL DEFAULT '',
  "category_ref"        TEXT,
  "category_name"       TEXT,
  "aspects"             JSONB,
  "condition"           TEXT NOT NULL DEFAULT 'NEW',
  "handling_time_days"  INTEGER,
  "delivery_template"   TEXT,
  "boost_pct"           DECIMAL(5,2) NOT NULL DEFAULT 0,
  "status"              TEXT NOT NULL DEFAULT 'DRAFT',
  "external_listing_id" TEXT,
  "listed_at"           TIMESTAMP(3),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT now(),
  "created_by"          UUID,
  "updated_by"          UUID,
  "deleted_at"          TIMESTAMP(3)
);
CREATE UNIQUE INDEX "product_channel_plan_product_integration_marketplace_key"
  ON "product_channel_plan" ("product_id", "integration_id", "marketplace");
CREATE INDEX "product_channel_plan_integration_status_idx"
  ON "product_channel_plan" ("integration_id", "status");
CREATE INDEX "product_channel_plan_deleted_at_idx"
  ON "product_channel_plan" ("deleted_at");

-- ---------------------------------------------------------------------------
-- Seed the mains facts for every marketplace in the connector registry.
--
-- Voltage columns describe the band a market's mains actually delivers, not a single nominal
-- figure — a product is judged compatible when its own rated range intersects this band, which
-- keeps a "230V only" product sellable in a 220-240V market without demanding exact numbers.
-- Plug letters are IEC: A/B North America & Japan, C Europlug, E France, F Schuko, G UK & Gulf,
-- I Australia, L Italy, D/M India & South Africa, N Brazil.
-- ---------------------------------------------------------------------------
INSERT INTO "marketplace_profile"
  ("id", "channel_type", "marketplace", "label", "mains_voltage_min_v", "mains_voltage_max_v", "mains_frequency_hz", "plug_types")
VALUES
  -- Amazon — North America
  (gen_random_uuid(), 'amazon', 'US', 'Amazon US', 110, 127, '60',    ARRAY['A','B']),
  (gen_random_uuid(), 'amazon', 'CA', 'Amazon CA', 110, 127, '60',    ARRAY['A','B']),
  (gen_random_uuid(), 'amazon', 'MX', 'Amazon MX', 120, 127, '60',    ARRAY['A','B']),
  (gen_random_uuid(), 'amazon', 'BR', 'Amazon BR', 127, 220, '60',    ARRAY['N','C']),
  -- Amazon — Europe
  (gen_random_uuid(), 'amazon', 'UK', 'Amazon UK', 220, 240, '50',    ARRAY['G']),
  (gen_random_uuid(), 'amazon', 'IE', 'Amazon IE', 220, 240, '50',    ARRAY['G']),
  (gen_random_uuid(), 'amazon', 'DE', 'Amazon DE', 220, 240, '50',    ARRAY['F','C']),
  (gen_random_uuid(), 'amazon', 'FR', 'Amazon FR', 220, 240, '50',    ARRAY['E','C']),
  (gen_random_uuid(), 'amazon', 'IT', 'Amazon IT', 220, 240, '50',    ARRAY['L','F','C']),
  (gen_random_uuid(), 'amazon', 'ES', 'Amazon ES', 220, 240, '50',    ARRAY['F','C']),
  (gen_random_uuid(), 'amazon', 'NL', 'Amazon NL', 220, 240, '50',    ARRAY['F','C']),
  (gen_random_uuid(), 'amazon', 'BE', 'Amazon BE', 220, 240, '50',    ARRAY['E','C']),
  (gen_random_uuid(), 'amazon', 'SE', 'Amazon SE', 220, 240, '50',    ARRAY['F','C']),
  (gen_random_uuid(), 'amazon', 'PL', 'Amazon PL', 220, 240, '50',    ARRAY['F','E','C']),
  (gen_random_uuid(), 'amazon', 'TR', 'Amazon TR', 220, 240, '50',    ARRAY['F','C']),
  (gen_random_uuid(), 'amazon', 'EG', 'Amazon EG', 220, 240, '50',    ARRAY['F','C']),
  (gen_random_uuid(), 'amazon', 'SA', 'Amazon SA', 220, 240, '60',    ARRAY['G']),
  (gen_random_uuid(), 'amazon', 'AE', 'Amazon AE (UAE)', 220, 240, '50', ARRAY['G']),
  (gen_random_uuid(), 'amazon', 'IN', 'Amazon IN', 220, 240, '50',    ARRAY['D','M','C']),
  (gen_random_uuid(), 'amazon', 'ZA', 'Amazon ZA', 220, 240, '50',    ARRAY['M','N','C']),
  -- Amazon — Far East
  (gen_random_uuid(), 'amazon', 'JP', 'Amazon JP', 100, 100, '50/60', ARRAY['A','B']),
  (gen_random_uuid(), 'amazon', 'AU', 'Amazon AU', 220, 240, '50',    ARRAY['I']),
  (gen_random_uuid(), 'amazon', 'SG', 'Amazon SG', 220, 240, '50',    ARRAY['G']),
  -- eBay. Britain is 'GB' here and 'UK' on Amazon — the channel's own id, not a normalised one.
  (gen_random_uuid(), 'ebay',   'GB', 'eBay UK',  220, 240, '50',    ARRAY['G']),
  (gen_random_uuid(), 'ebay',   'IE', 'eBay IE',  220, 240, '50',    ARRAY['G']),
  (gen_random_uuid(), 'ebay',   'DE', 'eBay DE',  220, 240, '50',    ARRAY['F','C']),
  (gen_random_uuid(), 'ebay',   'FR', 'eBay FR',  220, 240, '50',    ARRAY['E','C']),
  (gen_random_uuid(), 'ebay',   'IT', 'eBay IT',  220, 240, '50',    ARRAY['L','F','C']),
  (gen_random_uuid(), 'ebay',   'ES', 'eBay ES',  220, 240, '50',    ARRAY['F','C']),
  (gen_random_uuid(), 'ebay',   'US', 'eBay US',  110, 127, '60',    ARRAY['A','B']),
  (gen_random_uuid(), 'ebay',   'CA', 'eBay CA',  110, 127, '60',    ARRAY['A','B']),
  (gen_random_uuid(), 'ebay',   'AU', 'eBay AU',  220, 240, '50',    ARRAY['I']),
  -- OnBuy is UK-only.
  (gen_random_uuid(), 'onbuy',  'UK', 'OnBuy UK', 220, 240, '50',    ARRAY['G']);
