-- One nominated page was not enough.
--
-- The single `manufacturer_url` assumed the authoritative answer lives on exactly one page. In this
-- catalogue it frequently does not: a maker splits the specification across a product page and a
-- support page, or the only page stating the wattage belongs to a distributor. So a product carries
-- a LIST of pages a person has nominated, and the gather reads all of them.
--
-- Replaces the single column added minutes earlier rather than sitting beside it. Any value already
-- in it is carried across first, so nothing a person typed is thrown away even though the window in
-- which they could have typed one was small.
ALTER TABLE "product" ADD COLUMN "manufacturer_urls" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "product"
   SET "manufacturer_urls" = ARRAY["manufacturer_url"]
 WHERE "manufacturer_url" IS NOT NULL AND btrim("manufacturer_url") <> '';

ALTER TABLE "product" DROP COLUMN "manufacturer_url";
