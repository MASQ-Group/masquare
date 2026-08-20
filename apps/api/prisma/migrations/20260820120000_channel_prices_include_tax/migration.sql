-- Whether the listed price on a channel already contains the destination tax.
-- Existing behaviour (EU marketplaces, VAT-inclusive quoting) is the default.
ALTER TABLE "sales_channel"
  ADD COLUMN "prices_include_tax" BOOLEAN NOT NULL DEFAULT true;

-- Amazon AU: as an overseas seller we list GST-exclusive and Amazon adds GST at checkout,
-- so the listed price is our revenue. Applied to AU channels only; anything else is set by hand.
UPDATE "sales_channel" sc
   SET "prices_include_tax" = false
  FROM "country" c
 WHERE sc."native_country_id" = c."id"
   AND c."iso_code" = 'AU';
